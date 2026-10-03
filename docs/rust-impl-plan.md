# Rust implementation plan (`rust-impl` branch)

Goal: make the screencast pipeline as fast as possible, with ultra-low latency, a small memory footprint and frames rendered the moment they arrive.

---

## 1. How frames travel today

```
Chromium ──CDP WebSocket (JSON text, base64 PNG q=100)──► puppeteer-core in the extension host
   │                                                            │ JSON.parse of a multi-MB string
   │                                                            ▼
   │                                          BrowserPage.emit → Panel → webview.postMessage(obj)
   │                                                            │ serialized again, crosses 2 process hops
   │                                                            ▼    (ext host → renderer → webview iframe)
   │                                          Connection.onMessage → App.handleScreencastFrame
   │                                                            │ React setState on the whole <App/>
   │                                                            ▼
   │                                          <img src="data:image/png;base64,…">  (decoded on the main thread)
   │
   ◄──── Page.screencastFrameAck ─── webview → postMessage → ext host → CDP  (a full round trip per frame)
```

Relevant code: [BrowserPage.ts](../src/BrowserPage.ts) (`client.else` forwards every CDP event), [Panel.ts](../src/Panel.ts) (`postMessage(data)`), [App.tsx](../client/App.tsx) (`handleScreencastFrame`, `startCasting`), [screencast.tsx](../client/components/screencast/screencast.tsx) (`<img src=data:…>`).

### Where the time and memory actually go

| # | Cost | Why it hurts |
|---|------|--------------|
| 1 | **PNG at quality 100 is the default** (`amaze-browser.format`) | Chromium's PNG encoder is slow, and a 1080p frame is 1–3 MB, against 80–200 KB for JPEG q≈80. This is probably the largest single cost. |
| 2 | **base64 inside JSON, copied 4–5 times** | +33% size, then: the WS string, `JSON.parse`, the postMessage serialization, the webview copy, the data-URL string and the decoded bitmap. All of it lands on the V8 heap and drives GC. |
| 3 | **Ack round trip through the webview** | Once 3 frames are unacked (the default `maxFramesInFlight`), Chromium **drops** newly captured frames instead of queueing them. Playwright saw drops from ack delays of 30–50 ms ([playwright#42929](https://github.com/microsoft/playwright/pull/42929)). Our ack goes webview → ext host → Chromium, so it caps fps directly. |
| 4 | **Every frame re-renders the React tree** | `updateState({frame})` reconciles all of `App` about 60 times a second on the main thread, the same thread that handles input. |
| 5 | **`<img>` with a data URL** | Base64 and image decoding run synchronously, with no backpressure and no cleanup of the previous bitmap. |
| 6 | **Extension host is shared and single-threaded** | 30–100 MB/s of frame strings pass through the same event loop as every other installed extension. They slow us down and we slow them down. |
| 7 | **Input goes through the same path** | Each mousemove makes the same 2-hop trip, which adds input lag. |

### Measured (2026-10-03, bundled Chromium 1710656, `bench/index.html` at 1280×800, puppeteer straight to CDP)

| Config | fps | KB/frame | MB/s | capture → host | base64 decode / frame | JSON clone / hop |
|---|---|---|---|---|---|---|
| PNG q100, immediate ack | 59.4 | 442 | 25.6 | **24 ms** | 0.24 ms | 2.6 ms |
| PNG q100, ack +30 ms | **44.0** | 442 | 19.0 | 22 ms | 0.18 ms | 2.7 ms |
| JPEG q80, immediate ack | 60.0 | **32** | 1.9 | **≈0 ms** | 0.02 ms | 0.13 ms |
| JPEG q80, ack +30 ms | 59.6 | 32 | 1.8 | ≈0 ms | 0.02 ms | 0.12 ms |

What the numbers show: PNG adds about 24 ms of encode latency and is 14× larger. A late ack costs about 25% of fps with PNG. With JPEG, all the JS work in the host takes **under 0.2 ms per frame**, so a Rust rewrite of that work would save under 0.2 ms. What remains is the IPC hops and the webview decode, which Phase 1 already addresses.

### Measured in VS Code (2026-10-03, VS Code 1.103, `bench/index.html`, 15 s per run, 2–3 runs averaged)

`main` is the current release; `ts` is the Phase 1 pipeline; `rust` is the Phase 2 engine (`amaze-browser.engine: "rust"`). CPU is % of one core; "VS Code side" = extension host + VS Code processes + engine.

| Run | Painted fps | Latency p50 | Latency p95 | Ext host CPU | VS Code side CPU | Total incl. Chromium |
|---|---|---|---|---|---|---|
| main, PNG q100 (old default) | 52.6 | 48 ms | 72 ms | 42% | 259% | 467% |
| ts, PNG q100 | 47.3 | 45 ms | 70 ms | 38% | 180% | 403% |
| rust, PNG q100 | **57.9** | 40 ms | **48 ms** | **0%** | 128% | 349% |
| main, JPEG q80 | 60.0 | 13 ms | 24 ms | 17% | 138% | 278% |
| ts, JPEG q80 (new default) | 59.1 | 13 ms | 22 ms | 17% | 114% | 252% |
| rust, JPEG q80 | 59.8 | 12 ms | 22 ms | **0%** | **78%** | **214%** |

Compression of frames before sending was also measured and rejected: JPEG frames shrink only ~20% (31 → 25 KB) for 0.5–1.3 ms of CPU each, PNG frames 1–3%.

**Key insight:** almost none of this is CPU-bound JS logic that a faster language would fix. The cost comes from **encoding format, copies, process hops, round trips and main-thread work**. Rust only helps if it lets us *change the architecture*: own the CDP socket, ack immediately, send binary, and bypass the extension host. A line-by-line port of the TS would gain almost nothing.

---

## 2. Rust in VS Code extensions: the options

VS Code only loads JS extensions. The entry point (`activate`) and every `vscode.*` API call **must stay in TS/JS**. Rust can join in three ways:

| Option | How it works | Pros | Cons |
|--------|--------------|------|------|
| **A. Native addon (napi-rs)** | `.node` library loaded into the extension host with `require()`. Build with `@napi-rs/cli`. | Direct function calls, no extra process | Still runs **inside the shared ext host process**, so frames still go through `webview.postMessage`. A crash takes down the ext host. Needs one binary per platform. |
| **B. WebAssembly** (wasm-bindgen / `@vscode/wasm-wasi`) | `.wasm` runs in the ext host's V8 or in the webview | One binary for every platform, sandboxed, also works on vscode.dev | **No sockets** (WASI p1), so it can't own the CDP connection. Copies on every JS↔WASM boundary crossing. Threads need extra setup. Slower than the browser's native image decoders. |
| **C. Sidecar process** (how rust-analyzer works) | The extension spawns a Rust binary and talks to it over stdio, a pipe or a socket | **Process isolation** (separate threads and memory, and a crash doesn't kill VS Code). Can own the network I/O. Can be developed and benchmarked without VS Code. | Needs one binary per platform. Adds process management. |

### Decision: native Rust **sidecar** (C). Not WASM, not napi.

- **WASM is out for the hot path.** VS Code's WASM support (WASI 0.2 / component model) is synchronous and has no sockets ([VS Code blog](https://code.visualstudio.com/blogs/2024/05/08/wasm)), so it can't open the CDP WebSocket. In the webview it would decode JPEG/PNG slower than `createImageBitmap`. Native browser decoding measures 17–39× faster than JS/WASM decoders, and WASM averages 45–55% slower than native code ([Jangda et al.](https://people.cs.umass.edu/~arjun/main/papers/2019-jangda-browsix-spec.html)). In the ext host it only adds boundary copies. WASM is only worth it for portable pure computation, and this pipeline has none.
- **napi is close, but it doesn't fix cost #6.** Frames would still have to go through the ext host's JS thread to reach `postMessage`.
- **A sidecar lets frames skip the extension host entirely.** The path becomes Chromium → Rust → webview, over a binary WebSocket. The ext host keeps only the low-rate control messages.

Per-platform binaries are needed for A and C alike. We ship **platform-specific VSIXs** (`vsce package --target linux-x64 …`), which both the Marketplace and Open VSX support.

### Alternative to beat: "direct webview → Chromium"

A pure-TS option exists (local only: see the `portMapping` limitation in §6): the webview opens `ws://localhost:<port>/devtools/page/<id>` itself (Chromium already runs with `--remote-allow-origins=*`), and a Web Worker parses, acks and decodes frames. **Phase 1 builds this as the baseline.** The Rust sidecar must beat it on measured latency or memory, or we don't ship it. The sidecar should win on: binary frames (no JSON or base64 in the webview), frame pacing and stale-frame dropping before data crosses into the webview, one Chromium connection shared by panels and DevTools, replacing puppeteer, and security (the CDP port can be closed, see §6).

---

## 3. Target architecture

```
                      ┌──────────────────────── amaze-engine (Rust, tokio) ───────────────────────┐
 Chromium ◄──CDP────► │ cdp::Conn  ─► frame path: find "data" in the JSON → base64-simd decode     │
 (--remote-debugging  │               into a pooled buffer → ACK IMMEDIATELY → latest-frame-wins slot│
  -pipe or port)      │ control path: typed CDP commands/events (navigation, input, DOM, …)        │
                      │ stream::Server  127.0.0.1:<random>, token-auth, binary WS per panel         │
                      └──────▲───────────────────────────────────────────────▲─────────────────────┘
                 JSON-RPC over stdio (low rate)                   binary frames ↓  input ↑ (same WS)
                      ┌──────┴──────────┐                    ┌───────────────┴────────────────────────┐
                      │ Extension host   │                   │ Webview                                  │
                      │ (thin TS shell:  │ postMessage (UI   │  Worker: WS → createImageBitmap(jpeg)    │
                      │ vscode.* APIs,   │  state only)      │          → OffscreenCanvas.drawImage     │
                      │ panels, dialogs) │ ◄───────────────► │          → bitmap.close()                │
                      └─────────────────┘                    │  Main thread: React UI only, no frames   │
                                                             └──────────────────────────────────────────┘
```

### Frame wire format (engine → webview, one binary WS message per frame)

```
offset size  field
0      4     magic/version  ('AMZ1')
4      4     seq            u32
8      8     chromium timestamp (f64, from metadata.timestamp)
16     4     engine receive time (u32 µs, for latency stats)
20     2/2   deviceWidth / deviceHeight (u16)
24     4×4   offsetTop, pageScaleFactor, scrollOffsetX, scrollOffsetY (f32)
40     1     format (0=jpeg, 1=png)
41     ..    image bytes (as received from Chromium, never re-encoded)
```

Input goes back up the same socket as compact messages (mouse, wheel, key). They are rare enough that JSON is fine at first. The engine sends them to `Input.dispatch*` without touching the ext host.

### Latency and memory rules

1. **Ack on receipt** in the engine (before decoding), so Chromium can start encoding the next frame right away.
2. **Latest frame wins.** Each panel has one slot. If the webview hasn't drained the previous frame, overwrite it and never queue. Frames on screen can never fall behind.
3. **Zero re-encoding.** JPEG bytes are passed through unchanged. Rust only base64-decodes them, using SIMD and writing into reused buffers.
4. **Bounded memory.** About 2 buffers per panel in Rust, no growth. In the webview: transferable `ArrayBuffer` → `ImageBitmap` → draw → `close()`, so nothing is retained.
5. **The main thread never sees a frame.** The worker posts `{scrollOffset, pageScale}` to React only when they *change* (inspect mode needs them).
6. **Backpressure-aware pacing.** If the webview reports it can't keep up (dropped-frame counter), the engine raises `everyNthFrame` or lowers JPEG quality.
7. **Pause when hidden.** Stop the screencast when the panel isn't visible (`onDidChangeViewState`). Today `retainContextWhenHidden` keeps it streaming in the background.

---

## 4. Rust crate layout

```
engine/                     (cargo workspace at repo root: /engine)
  Cargo.toml
  crates/
    cdp/        thin CDP client: tokio + fastwebsockets (or tokio-tungstenite), pipe transport,
                serde types for only the domains we use (generated from devtools-protocol JSON
                or taken from chromiumoxide_cdp), plus a zero-copy fast path for Page.screencastFrame
    browser/    find/download/launch Chromium, profiles, user-data-dir, downloads (replaces
                puppeteer-core + karma launchers + ChromiumDownloader.ts)
    stream/     token-authenticated localhost WS server, frame slots, wire format, input decode
    rpc/        JSON-RPC over stdio for the TS shell (ready, newPage, navigate, dispose, events…)
    engine/     the binary (main.rs): wiring, logging (tracing), metrics
  benches/      criterion: frame parse+decode, end-to-end through a mock CDP server
```

Main crates: `tokio`, `fastwebsockets`/`tokio-tungstenite`, `serde` + `sonic-rs` (SIMD JSON, used for the control path), `base64-simd`, `bytes`, `tracing`, `criterion`.

TS side after the port: `src/` becomes a thin shell (`EngineClient.ts` spawns the binary and talks JSON-RPC; `Panel.ts`/`PanelManager.ts` keep the VS Code UI). Webview gets `client/stream/worker.ts` + a `<canvas>` Screencast component.

---

## 5. Phases

Each phase ends with a measured result. If a phase doesn't move the numbers, we stop there.

### Phase 0: Measure (about 1 day)
- Add a `amaze-browser.perfHud` setting: an overlay showing fps, glass-to-glass latency (Chromium `metadata.timestamp` → `requestAnimationFrame` after draw), dropped frames, ext host CPU and webview heap.
- A benchmark page in `bench/` with a CSS animation, a 60fps canvas, scrolling and a long page.
- Record a baseline with the current code at PNG q100, then at JPEG q80.

### Phase 1: TS quick wins and the "direct" baseline (2–3 days, no Rust yet)
- Default to `jpeg`, quality 80. Pass `maxWidth/maxHeight` equal to the canvas size × DPR.
- Ack in the extension host instead of the webview. Drop stale frames there.
- Send frames as a `Uint8Array` (binary postMessage) instead of a base64 string.
- Replace `<img data:>` with a worker + `OffscreenCanvas` + `createImageBitmap`. Take frames out of React state.
- Pause the screencast when the panel is hidden.
- Prototype: the webview connects straight to the Chromium page WS (also tests whether `portMapping` carries WebSockets in remote/SSH setups).
- *Benefit:* these changes help whether or not the Rust engine lands, and they give the bar Rust has to beat.

### Phase 2: Rust engine data plane (about 1 week)
- Set up the toolchain: `rustup`, `cargo` workspace in `engine/`, `cargo-zigbuild` or `cross` for cross-compiling.
- `cdp` crate: connect to the page target **next to** puppeteer (Chromium supports several clients per target). Only the engine starts the screencast.
- `stream` crate: binary WS, frame slot, wire format, input.
- TS: spawn the engine and give the webview `{port, token, targetId}`.
- Gate it behind the `amaze-browser.engine: "rust" | "ts"` setting.
- Benchmark against Phase 1. **Go/no-go gate.**

### Phase 3: Rust control plane (1–2 weeks)
- Move the rest of the CDP logic into Rust: page lifecycle, navigation and history, dialogs, file chooser, downloads, find-in-page, inspect/highlight, device emulation, cookies.
- Move Chromium launch, discovery and download into `browser`. **Remove `puppeteer-core`** and the karma launchers. This makes the VSIX much smaller and the ext host lighter.
- The TS shell only does things that need `vscode.*`: panels, dialogs (`showOpenDialog`, `showInputBox`…), clipboard, opening files, settings.
- The webview talks to the engine over WS for CDP calls, and to the ext host only for UI messages.

### Phase 4: Packaging and CI (2–3 days)
- CI matrix that builds `engine` for `linux-x64, linux-arm64, alpine-x64, darwin-x64, darwin-arm64, win32-x64, win32-arm64`.
- `vsce package --target <t>` per platform, plus a universal fallback VSIX that uses the TS engine.
- Publish all targets to Open VSX in the existing workflow.

### Phase 5 (optional, only if the measurements call for it)
- Dirty-rect/tile diffing for remote (SSH) sessions where bandwidth is the limit.
- `--remote-debugging-pipe` with the engine proxying the DevTools frontend WS, so no TCP debug port is exposed.

---

## 6. Risks and open questions

| Risk | Mitigation |
|------|------------|
| Webview → localhost WS in **remote/SSH/Codespaces** (`extensionKind: workspace`) | **`portMapping` does not work for WebSockets**, because the spec forbids redirecting the handshake ([vscode#74085](https://github.com/microsoft/vscode/issues/74085)). Locally the webview connects to `ws://127.0.0.1:<real port>` (no CSP blocks it). Remote: try `env.asExternalUri`. Fallback: engine → ext host stdio → `postMessage(Uint8Array)`, which is efficient for engines ≥1.57 ([vscode#115807](https://github.com/microsoft/vscode/issues/115807)), still binary, and has no ack round trip. |
| Any local process or web page could connect to the engine's port | Bind to 127.0.0.1, use a random port, require a 128-bit token in the first message, reject other `Origin`s. *Note:* the current `--remote-allow-origins=*` already lets **any website the user visits in any browser** drive this Chromium over `localhost:9222`. Fix that regardless of Rust. |
| Per-platform binaries and CI complexity | `cargo-zigbuild`, the universal TS fallback VSIX, and an engine-version handshake. |
| Antivirus / macOS Gatekeeper flags the spawned binary | Sign macOS/Windows binaries (later), and fall back to the TS engine if spawning fails. |
| Big-bang rewrite risk | Feature flag plus the parallel TS engine until Phase 3 has reached parity. |
| Not verified yet | How many unacked frames Chromium allows in flight. How fast binary `postMessage` is in VS Code ≥1.83. `ImageDecoder` vs `createImageBitmap` in VS Code's Electron. All are covered in Phase 0/1. |

## 7. Success criteria

| Metric (1080p, benchmark page) | Now (expected) | Target |
|---|---|---|
| Glass-to-glass latency (pipeline overhead beyond Chromium's encode) | 50–150 ms | **< 16 ms** |
| Sustained fps on the animation page | 10–25 | **≥ 55** |
| Ext host CPU while streaming | high | **≈ 0%** (frames bypass it) |
| Webview memory growth over 10 minutes of streaming | grows with GC churn | **flat** |
| Input → visible response | 2 hops plus the ack queue | **1 hop** |

The "Now" column is an estimate. Phase 0 replaces it with measured numbers.
