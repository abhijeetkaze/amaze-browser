//! amaze-engine: streams screencast frames from Chromium straight to the webview.
//!
//! The extension spawns it with `--cdp-port <port>`. It prints `{"port":..,"token":".."}` on
//! stdout and exits when stdin closes (the extension host went away).
//!
//! The webview, or a browser tab served by the extension's HTTP server, connects to
//! `ws://127.0.0.1:<port>/?token=<token>&target=<page target id>`.
//! The engine opens its own CDP connection to that page and then:
//! - webview → engine (text): `{"cmd":"start","params":{..}}` / `{"cmd":"stop"}` / `d` (frame decoded)
//! - engine → webview (binary): one packet per frame, see `frame.rs`
//!
//! Frames are acked to Chromium as soon as they arrive (Chromium drops frames while 3 are unacked)
//! and only the newest undelivered frame is kept, so the webview never falls behind.

mod frame;

use std::error::Error;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Notify, mpsc};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::{Bytes, Message};
use tokio_tungstenite::{accept_hdr_async, connect_async};

type BoxError = Box<dyn Error + Send + Sync>;

// AMAZE_ENGINE_LOG=<file> appends a trace of connections, commands and frame counts
static LOG: std::sync::OnceLock<Option<Mutex<std::fs::File>>> = std::sync::OnceLock::new();

macro_rules! log {
    ($($arg:tt)*) => {
        if let Some(Some(file)) = LOG.get() {
            use std::io::Write;
            let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
            let _ = writeln!(file.lock().unwrap(), "{ms} {}", format!($($arg)*));
        }
    };
}

// a webview that stops reporting decoded frames (e.g. reloaded mid-frame) must not freeze the stream
const DRAWN_TIMEOUT: Duration = Duration::from_secs(1);
// Chromium rejects startScreencast while the page is mid-navigation ("Not attached to an active page")
const START_RETRY_DELAY: Duration = Duration::from_millis(200);
const START_RETRIES: u32 = 50;

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() -> Result<(), BoxError> {
    let cdp_port = parse_cdp_port().ok_or("usage: amaze-engine --cdp-port <port>")?;
    LOG.get_or_init(|| {
        let path = std::env::var_os("AMAZE_ENGINE_LOG")?;
        std::fs::OpenOptions::new().create(true).append(true).open(path).ok().map(Mutex::new)
    });
    log!("start, cdp port {cdp_port}");

    let mut raw = [0u8; 16];
    getrandom::fill(&mut raw).map_err(|e| e.to_string())?;
    let token: Arc<str> = raw.iter().map(|b| format!("{b:02x}")).collect::<String>().into();

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let mut stdout = tokio::io::stdout();
    stdout.write_all(format!("{{\"port\":{port},\"token\":\"{token}\"}}\n").as_bytes()).await?;
    stdout.flush().await?;

    // the extension host keeps our stdin open; EOF means it's gone and so should we be
    tokio::spawn(async {
        let mut stdin = tokio::io::stdin();
        let mut buf = [0u8; 64];
        while matches!(stdin.read(&mut buf).await, Ok(n) if n > 0) {}
        std::process::exit(0);
    });

    loop {
        let (stream, _) = listener.accept().await?;
        let token = token.clone();
        tokio::spawn(async move {
            if let Err(e) = serve(stream, &token, cdp_port).await {
                eprintln!("amaze-engine: connection closed: {e}");
            }
        });
    }
}

fn parse_cdp_port() -> Option<u16> {
    let args: Vec<String> = std::env::args().collect();
    let i = args.iter().position(|a| a == "--cdp-port")?;
    args.get(i + 1)?.parse().ok()
}

#[derive(Deserialize)]
struct Command {
    cmd: String,
    #[serde(default)]
    params: serde_json::Value,
}

async fn serve(stream: TcpStream, token: &str, cdp_port: u16) -> Result<(), BoxError> {
    let mut target = None;
    let client = accept_hdr_async(stream, |req: &Request, res: Response| match authorize(req, token) {
        Some(t) => {
            target = Some(t);
            Ok(res)
        }
        None => Err(forbidden()),
    })
    .await?;
    let target = target.ok_or("no target")?;
    log!("webview connected for target {target}");

    let (cdp, _) = connect_async(format!("ws://127.0.0.1:{cdp_port}/devtools/page/{target}")).await?;
    log!("cdp connected");
    let (mut cdp_tx, mut cdp_rx) = cdp.split();
    let (mut client_tx, mut client_rx) = client.split();

    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<String>();
    let next_id = AtomicU64::new(1);
    let send_cdp = |method: &str, params: serde_json::Value| {
        let id = next_id.fetch_add(1, Ordering::Relaxed);
        let _ = cmd_tx.send(serde_json::json!({ "id": id, "method": method, "params": params }).to_string());
        id
    };

    // the screencast the webview asked for (None after stop), retried until Chromium accepts it
    let wanted: Mutex<Option<serde_json::Value>> = Mutex::new(None);
    let start_id = AtomicU64::new(0);
    let start_failed = Notify::new();
    let start = |params: serde_json::Value| start_id.store(send_cdp("Page.startScreencast", params), Ordering::Relaxed);

    // newest frame not yet sent to the webview
    let slot: Mutex<Option<Bytes>> = Mutex::new(None);
    let frame_ready = Notify::new();
    let drawn = Notify::new();

    let cdp_writer = async {
        while let Some(m) = cmd_rx.recv().await {
            cdp_tx.send(Message::text(m)).await?;
        }
        Ok::<_, BoxError>(())
    };

    let cdp_reader = async {
        let mut dropped = 0u32;
        while let Some(msg) = cdp_rx.next().await {
            let Message::Text(text) = msg? else { continue };
            let Some(frame) = frame::parse(text.as_str(), dropped) else {
                log!("cdp: {}", text.as_str().chars().take(160).collect::<String>());
                if is_error_for(text.as_str(), start_id.load(Ordering::Relaxed)) {
                    start_failed.notify_one();
                }
                continue;
            };
            send_cdp("Page.screencastFrameAck", serde_json::json!({ "sessionId": frame.session_id }));
            if slot.lock().unwrap().replace(Bytes::from(frame.packet)).is_some() {
                dropped += 1;
            }
            frame_ready.notify_one();
        }
        Ok::<_, BoxError>(())
    };

    let client_writer = async {
        let mut sent = 0u64;
        loop {
            frame_ready.notified().await;
            let Some(packet) = slot.lock().unwrap().take() else { continue };
            client_tx.send(Message::Binary(packet)).await?;
            sent += 1;
            if sent % 60 == 1 {
                log!("sent {sent} frames");
            }
            // the next frame waits until this one is decoded: no queue builds up in the webview
            let _ = tokio::time::timeout(DRAWN_TIMEOUT, drawn.notified()).await;
        }
        #[allow(unreachable_code)]
        Ok::<_, BoxError>(())
    };

    let client_reader = async {
        while let Some(msg) = client_rx.next().await {
            match msg? {
                Message::Text(t) if t.as_str() == "d" => drawn.notify_one(),
                // only screencast control: the webview must not get a general CDP proxy here
                Message::Text(t) => match { log!("webview: {}", t.as_str()); serde_json::from_str::<Command>(t.as_str()) } {
                    Ok(c) if c.cmd == "start" => {
                        *wanted.lock().unwrap() = Some(c.params.clone());
                        start(c.params);
                    }
                    Ok(c) if c.cmd == "stop" => {
                        *wanted.lock().unwrap() = None;
                        send_cdp("Page.stopScreencast", serde_json::json!({}));
                    }
                    _ => {}
                },
                Message::Close(_) => break,
                _ => {}
            }
        }
        Ok::<_, BoxError>(())
    };

    let start_retrier = async {
        let mut retries = 0;
        loop {
            start_failed.notified().await;
            tokio::time::sleep(START_RETRY_DELAY).await;
            let params = wanted.lock().unwrap().clone();
            match params {
                Some(params) if retries < START_RETRIES => {
                    retries += 1;
                    log!("retrying startScreencast ({retries})");
                    start(params);
                }
                _ => retries = 0,
            }
        }
        #[allow(unreachable_code)]
        Ok::<_, BoxError>(())
    };

    // whichever side ends first ends the whole connection
    let result = tokio::select! {
        r = start_retrier => ("start retrier", r),
        r = cdp_writer => ("cdp writer", r),
        r = cdp_reader => ("cdp reader", r),
        r = client_writer => ("webview writer", r),
        r = client_reader => ("webview reader", r),
    };
    log!("connection ended by {}: {:?}", result.0, result.1.as_ref().err().map(|e| e.to_string()));
    result.1
}

/// Whether `message` is the error response to the CDP command `id`.
fn is_error_for(message: &str, id: u64) -> bool {
    #[derive(Deserialize)]
    struct Response {
        id: Option<u64>,
        error: Option<serde_json::Value>,
    }
    id != 0
        && serde_json::from_str::<Response>(message).is_ok_and(|r| r.id == Some(id) && r.error.is_some())
}

/// Checks the token and origin, returns the requested page target id.
fn authorize(req: &Request, token: &str) -> Option<String> {
    let origin = req.headers().get("origin")?.to_str().ok()?;
    if !is_allowed_origin(origin) {
        return None;
    }

    let mut given_token = None;
    let mut target = None;
    for pair in req.uri().query()?.split('&') {
        match pair.split_once('=') {
            Some(("token", v)) => given_token = Some(v),
            Some(("target", v)) => target = Some(v),
            _ => {}
        }
    }
    let target = target?;
    if !constant_time_eq(given_token?.as_bytes(), token.as_bytes())
        || target.is_empty()
        || target.len() > 64
        || !target.bytes().all(|b| b.is_ascii_alphanumeric())
    {
        return None;
    }
    Some(target.to_string())
}

/// Webviews, and browser tabs served by the extension's HTTP server on this machine. Other
/// web pages are refused even before the token check.
fn is_allowed_origin(origin: &str) -> bool {
    if origin.starts_with("vscode-webview://") {
        return true;
    }
    let Some(host) = origin.strip_prefix("http://") else {
        return false;
    };
    // the whole host must match: "localhost.example.com" is not localhost
    let name = match host.rsplit_once(':') {
        Some((name, port)) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => name,
        _ => host,
    };
    matches!(name, "localhost" | "127.0.0.1" | "[::1]")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_webviews_and_local_http_server_tabs_only() {
        assert!(is_allowed_origin("vscode-webview://1abc2def"));
        assert!(is_allowed_origin("http://localhost:8100"));
        assert!(is_allowed_origin("http://127.0.0.1:8100"));
        assert!(is_allowed_origin("http://[::1]:8100"));
        assert!(is_allowed_origin("http://localhost"));
        assert!(!is_allowed_origin("http://localhost.example.com:8100"));
        assert!(!is_allowed_origin("http://example.com"));
        assert!(!is_allowed_origin("https://localhost:8100"));
        assert!(!is_allowed_origin("http://localhost:8100/path"));
        assert!(!is_allowed_origin("http://localhost:"));
        assert!(!is_allowed_origin("null"));
    }

    #[test]
    fn detects_error_for_command() {
        let err = r#"{"id":2,"error":{"code":-32000,"message":"Not attached to an active page"}}"#;
        assert!(is_error_for(err, 2));
        assert!(!is_error_for(err, 3));
        assert!(!is_error_for(r#"{"id":2,"result":{}}"#, 2));
        assert!(!is_error_for(err, 0));
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn forbidden() -> ErrorResponse {
    let mut res = ErrorResponse::new(Some("forbidden".into()));
    *res.status_mut() = StatusCode::FORBIDDEN;
    res
}
