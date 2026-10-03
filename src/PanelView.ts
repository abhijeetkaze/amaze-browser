import { Buffer } from 'buffer'
import type { Event, WebviewPanel } from 'vscode'
import { EventEmitter, Uri } from 'vscode'
import type { WebSocket } from 'ws'

/**
 * Where a Panel's UI runs: a VS Code webview, or a tab of the user's own browser
 * connected through the HTTP server. The Panel only talks to the UI through this.
 */
export interface PanelView {
  // a tab of the user's browser: it handles new tabs, DevTools and dialogs itself
  readonly isRemote: boolean
  readonly onDidReceiveMessage: Event<any>
  readonly onDidDispose: Event<void>
  readonly onDidChangeActive: Event<boolean>
  // the webview is hidden, e.g. behind another editor tab; a browser tab watches its own visibility
  readonly onDidChangeVisible: Event<boolean>
  postMessage(message: unknown): void
  setTitle(title: string): void
  setIcon(url: string): void
  reveal(): void
  dispose(): void
}

export class WebviewPanelView implements PanelView {
  readonly isRemote = false
  readonly onDidReceiveMessage: Event<any>
  readonly onDidDispose: Event<void>
  readonly onDidChangeActive: Event<boolean>
  readonly onDidChangeVisible: Event<boolean>

  constructor(private readonly panel: WebviewPanel) {
    this.onDidReceiveMessage = panel.webview.onDidReceiveMessage
    this.onDidDispose = panel.onDidDispose
    this.onDidChangeActive = (listener, thisArgs?, disposables?) =>
      panel.onDidChangeViewState(() => listener.call(thisArgs, panel.active), null, disposables)
    this.onDidChangeVisible = (listener, thisArgs?, disposables?) =>
      panel.onDidChangeViewState(() => listener.call(thisArgs, panel.visible), null, disposables)
  }

  postMessage(message: unknown) {
    this.panel.webview.postMessage(message)
  }

  setTitle(title: string) {
    this.panel.title = title
  }

  setIcon(url: string) {
    this.panel.iconPath = Uri.parse(url)
  }

  reveal() {
    this.panel.reveal(undefined, false)
  }

  dispose() {
    this.panel.dispose()
  }
}

// how long a page outlives its browser tab, so reloading the tab gets the same page back
const RECONNECT_GRACE = 30_000

/**
 * A tab of the user's browser. Reloading the tab reconnects with the same session id,
 * which attaches the new socket to this view instead of opening another page.
 */
export class SocketView implements PanelView {
  readonly isRemote = true
  private readonly messages = new EventEmitter<any>()
  private readonly disposed = new EventEmitter<void>()
  // messages that arrive before the panel listens (it first waits for Chromium to start)
  private pending: any[] | undefined = []
  readonly onDidDispose = this.disposed.event
  // VS Code's "current panel" (refresh, DevTools commands...) only means webviews
  readonly onDidChangeActive: Event<boolean> = () => ({ dispose() {} })
  readonly onDidChangeVisible: Event<boolean> = () => ({ dispose() {} })
  private socket: WebSocket | undefined
  private closeTimer: ReturnType<typeof setTimeout> | undefined
  private isDisposed = false

  constructor(socket: WebSocket) {
    this.attach(socket)
  }

  readonly onDidReceiveMessage: Event<any> = (listener, thisArgs?, disposables?) => {
    const subscription = this.messages.event(listener, thisArgs, disposables)
    const pending = this.pending
    this.pending = undefined
    pending?.forEach(message => listener.call(thisArgs, message))
    return subscription
  }

  get alive() {
    return !this.isDisposed
  }

  attach(socket: WebSocket) {
    clearTimeout(this.closeTimer)
    const previous = this.socket
    this.socket = socket
    // e.g. a duplicated tab took over the session: the other one starts its own
    previous?.close(4000, 'session taken over')

    socket.on('message', (data) => {
      if (this.socket !== socket)
        return
      let message
      try {
        message = JSON.parse(data.toString())
      }
      catch {
        return
      }
      if (this.pending)
        this.pending.push(message)
      else
        this.messages.fire(message)
    })
    socket.on('close', () => {
      if (this.socket === socket && !this.isDisposed)
        this.closeTimer = setTimeout(() => this.dispose(), RECONNECT_GRACE)
    })
  }

  postMessage(message: any) {
    // while the tab reconnects, messages (mostly frames) are dropped; it asks for the state again
    if (this.socket?.readyState !== this.socket?.OPEN)
      return
    if (message?.method === 'extension.screencastFrame')
      this.socket!.send(framePacket(message.result))
    else
      this.socket!.send(JSON.stringify(message))
  }

  // the tab sets its own title from the page
  setTitle() {}
  setIcon() {}
  reveal() {}

  dispose() {
    if (this.isDisposed)
      return
    this.isDisposed = true
    clearTimeout(this.closeTimer)
    this.socket?.close(1001, 'closed')
    this.disposed.fire()
    this.messages.dispose()
    this.disposed.dispose()
  }
}

// A frame as binary, in the Rust engine's packet layout (engine/src/frame.rs): JSON would turn the image into a huge array
function framePacket({ data, metadata, droppedFrames }: { data: ArrayBuffer, metadata: { timestamp?: number }, droppedFrames: number }) {
  const header = Buffer.alloc(36)
  header.writeDoubleLE(metadata.timestamp ?? 0, 0)
  header.writeUInt32LE(droppedFrames >>> 0, 32)
  return Buffer.concat([header, Buffer.from(data)])
}
