//! Turns a CDP `Page.screencastFrame` event into the binary packet the webview draws.
//!
//! Packet layout (little endian):
//!
//! | offset | type | field |
//! |--------|------|-------|
//! | 0      | f64  | capture timestamp, seconds since epoch (0 when Chromium omits it) |
//! | 8      | f32  | offsetTop |
//! | 12     | f32  | pageScaleFactor |
//! | 16     | f32  | deviceWidth |
//! | 20     | f32  | deviceHeight |
//! | 24     | f32  | scrollOffsetX |
//! | 28     | f32  | scrollOffsetY |
//! | 32     | u32  | frames dropped so far (replaced before the webview drew them) |
//! | 36     | ...  | image bytes exactly as Chromium encoded them (jpeg/png) |

use std::borrow::Cow;

use serde::Deserialize;

pub const HEADER_LEN: usize = 36;

const METHOD: &str = "\"Page.screencastFrame\"";

#[derive(Deserialize)]
struct Event<'a> {
    #[serde(borrow)]
    params: Params<'a>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Params<'a> {
    // borrowed straight from the websocket message: base64 never contains escapes
    #[serde(borrow)]
    data: Cow<'a, str>,
    metadata: Metadata,
    session_id: i64,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Metadata {
    offset_top: f64,
    page_scale_factor: f64,
    device_width: f64,
    device_height: f64,
    scroll_offset_x: f64,
    scroll_offset_y: f64,
    timestamp: Option<f64>,
}

pub struct Frame {
    /// header + image bytes, ready to send
    pub packet: Vec<u8>,
    pub session_id: i64,
}

/// Returns `None` for anything that isn't a well-formed screencast frame.
pub fn parse(message: &str, dropped: u32) -> Option<Frame> {
    // cheap reject for the other CDP traffic; base64 has no quotes so the payload can't match
    if !message.contains(METHOD) {
        return None;
    }
    let event: Event = serde_json::from_str(message).ok()?;
    let p = event.params;
    let m = &p.metadata;

    let data = p.data.as_bytes();
    let mut packet = Vec::with_capacity(HEADER_LEN + data.len() / 4 * 3);
    packet.extend_from_slice(&m.timestamp.unwrap_or(0.0).to_le_bytes());
    for v in [m.offset_top, m.page_scale_factor, m.device_width, m.device_height, m.scroll_offset_x, m.scroll_offset_y] {
        packet.extend_from_slice(&(v as f32).to_le_bytes());
    }
    packet.extend_from_slice(&dropped.to_le_bytes());
    base64_simd::STANDARD.decode_append(data, &mut packet).ok()?;

    Some(Frame { packet, session_id: p.session_id })
}

#[cfg(test)]
mod tests {
    use super::*;

    const EVENT: &str = r#"{"method":"Page.screencastFrame","params":{"data":"/9j/4AAQ","metadata":{"offsetTop":0,"pageScaleFactor":1,"deviceWidth":1280,"deviceHeight":800,"scrollOffsetX":0,"scrollOffsetY":42.5,"timestamp":1791015529.25},"sessionId":7}}"#;

    #[test]
    fn parses_frame_into_packet() {
        let frame = parse(EVENT, 3).unwrap();
        let p = &frame.packet;
        assert_eq!(frame.session_id, 7);
        assert_eq!(f64::from_le_bytes(p[0..8].try_into().unwrap()), 1791015529.25);
        assert_eq!(f32::from_le_bytes(p[16..20].try_into().unwrap()), 1280.0);
        assert_eq!(f32::from_le_bytes(p[28..32].try_into().unwrap()), 42.5);
        assert_eq!(u32::from_le_bytes(p[32..36].try_into().unwrap()), 3);
        // "/9j/4AAQ" is the start of a JPEG: FF D8 FF E0 00 10
        assert_eq!(&p[HEADER_LEN..], &[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    }

    #[test]
    fn ignores_other_messages() {
        assert!(parse(r#"{"id":1,"result":{}}"#, 0).is_none());
        assert!(parse(r#"{"method":"Page.loadEventFired","params":{"timestamp":1}}"#, 0).is_none());
    }

    #[test]
    fn rejects_invalid_base64() {
        let bad = EVENT.replace("/9j/4AAQ", "not base64!");
        assert!(parse(&bad, 0).is_none());
    }

    #[test]
    fn missing_timestamp_is_zero() {
        let event = EVENT.replace(r#","timestamp":1791015529.25"#, "");
        let frame = parse(&event, 0).unwrap();
        assert_eq!(f64::from_le_bytes(frame.packet[0..8].try_into().unwrap()), 0.0);
    }
}
