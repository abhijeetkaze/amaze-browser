import type { ScreencastFrame } from './components/screencast/screencast'

export interface EngineEndpoint {
  port: number
  token: string
  targetId: string
}

// see engine/src/frame.rs for the packet layout
const HEADER_LEN = 36

// also used for frames the extension host sends to a browser tab
export function parseFramePacket(packet: ArrayBuffer): ScreencastFrame {
  const header = new DataView(packet, 0, HEADER_LEN)
  return {
    data: new Uint8Array(packet, HEADER_LEN),
    metadata: { timestamp: header.getFloat64(0, true) || undefined },
    droppedFrames: header.getUint32(32, true),
  }
}

/**
 * Frames from the Rust engine: a direct WebSocket to it, so frames never pass
 * through the extension host. Calls onUnavailable whenever the socket closes on its own,
 * so the caller can fall back to streaming through the extension host.
 */
export default class EngineStream {
  private socket: WebSocket
  private queue: string[] = []
  private connected = false

  constructor(endpoint: EngineEndpoint, onFrame: (frame: ScreencastFrame) => void, onUnavailable: () => void) {
    const { port, token, targetId } = endpoint
    this.socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}&target=${targetId}`)
    this.socket.binaryType = 'arraybuffer'
    this.socket.onopen = () => {
      this.connected = true
      this.queue.forEach(m => this.socket.send(m))
      this.queue = []
    }
    this.socket.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer))
        return
      onFrame(parseFramePacket(event.data))
    }
    // closed without dispose(): can't connect (remote session), engine couldn't reach Chromium, or it exited
    this.socket.onclose = () => {
      this.connected = false
      onUnavailable()
    }
  }

  start(params: object) {
    this.post(JSON.stringify({ cmd: 'start', params }))
  }

  stop() {
    this.post(JSON.stringify({ cmd: 'stop' }))
  }

  // the frame is decoded: the engine may send the next one
  frameDrawn() {
    if (this.connected)
      this.socket.send('d')
  }

  dispose() {
    this.socket.onclose = null
    this.socket.close()
  }

  private post(message: string) {
    if (this.connected)
      this.socket.send(message)
    else if (this.socket.readyState === WebSocket.CONNECTING)
      this.queue.push(message)
  }
}
