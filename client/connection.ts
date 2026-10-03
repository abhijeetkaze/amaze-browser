import { EventEmitter2 } from 'eventemitter2'
import Logger from './utils/logger'

const SESSION_KEY = 'amaze-browser-session'
// when the tab reloaded itself to reconnect, so repeated drops can't turn into a reload loop
const RELOADS_KEY = 'amaze-browser-reloads'
const RELOAD_WINDOW = 30_000
const MAX_RELOADS = 3

export default class Connection extends EventEmitter2 {
  private lastId: number
  private vscode: any
  private callbacks: Map<number, object>
  private logger: Logger
  // outside VS Code (a tab of the user's browser served by the extension's HTTP server)
  private socket: WebSocket | undefined
  private queue: string[] = []
  // retries of a socket that never opened (refused or unreachable)
  private connectAttempts = 0
  public readonly isRemote: boolean

  constructor() {
    super()
    this.lastId = 0
    this.callbacks = new Map()
    this.logger = new Logger()

    try {
      // @ts-expect-error only defined in VS Code webviews
      this.vscode = acquireVsCodeApi()
    }
    catch {
      this.vscode = null
    }
    this.isRemote = !this.vscode && location.protocol.startsWith('http')

    if (this.isRemote)
      this.connectSocket()
    else
      window.addEventListener('message', event => this.onMessage(event.data))
  }

  send<T>(method: string, params = {}): Promise<T> {
    const id = ++this.lastId

    this.logger.log('SEND ► ', method, params)

    const message = {
      callbackId: id,
      params,
      type: method,
    }
    if (this.vscode)
      this.vscode.postMessage(message)
    else if (this.socket)
      this.post(JSON.stringify(message))

    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject, error: new Error('Unknown'), method })
    })
  }

  private post(data: string) {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(data)
    else
      this.queue.push(data)
  }

  // The session id survives reloads of the tab (sessionStorage), so a reload gets the same page back
  private connectSocket() {
    const search = new URLSearchParams(location.search)
    // a tab opened from another one starts with a copy of its sessionStorage: it gets its own
    // session; the marker goes away so reloading this tab keeps the new one
    if (search.has('newTab')) {
      sessionStorage.removeItem(SESSION_KEY)
      search.delete('newTab')
      const rest = search.toString()
      history.replaceState(null, '', rest ? `${location.pathname}?${rest}` : location.pathname)
    }
    let session = sessionStorage.getItem(SESSION_KEY)
    if (!session) {
      session = crypto.randomUUID()
      sessionStorage.setItem(SESSION_KEY, session)
    }
    const params = new URLSearchParams({ session })
    // the page to open, e.g. from "Open Link in New Tab"
    const url = search.get('url')
    if (url)
      params.set('url', url)

    // next to the page, and wss: when the page came over https (e.g. a forwarded port)
    const endpoint = new URL(`ws?${params}`, location.href)
    endpoint.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(endpoint)
    this.socket = socket
    let opened = false
    socket.onopen = () => {
      opened = true
      this.connectAttempts = 0
      this.showStatus(null)
      this.queue.forEach(data => socket.send(data))
      this.queue = []
    }
    socket.onmessage = event => this.onMessage(JSON.parse(event.data))
    socket.onclose = (event) => {
      console.warn(`Amaze Browser: connection closed (code ${event.code}${event.reason ? `, ${event.reason}` : ''})`)
      // another tab (e.g. a duplicate of this one) took this page over: leave it to that tab
      if (event.code === 4000) {
        this.showStatus('This page is open in another tab.', { label: 'Use here', action: () => location.reload() })
        return
      }
      // refused or unreachable: reloading would only repeat that; what was sent waits in the queue
      if (!opened) {
        this.connectAttempts++
        this.showStatus(`Can't connect to Amaze Browser in VS Code (code ${event.code}). Retrying…`)
        setTimeout(() => this.connectSocket(), Math.min(1000 * this.connectAttempts, 10_000))
        return
      }
      this.reloadWhenServerIsBack(event.code)
    }
  }

  // The page and its state live in VS Code: once the server answers again, reloading picks
  // them up. A connection that keeps dropping stops here instead of reloading over and over
  private reloadWhenServerIsBack(code: number) {
    const now = Date.now()
    let recent: number[] = []
    try {
      recent = (JSON.parse(sessionStorage.getItem(RELOADS_KEY) || '[]') as number[]).filter(t => now - t < RELOAD_WINDOW)
    }
    catch {}
    const reload = (reloads: number[]) => {
      sessionStorage.setItem(RELOADS_KEY, JSON.stringify(reloads))
      location.reload()
    }
    if (recent.length >= MAX_RELOADS) {
      this.showStatus(`The connection to VS Code keeps dropping (code ${code}).`, { label: 'Reload', action: () => reload([]) })
      return
    }

    this.showStatus('Reconnecting to VS Code…')
    const retry = () => fetch('./', { method: 'HEAD', cache: 'no-store' })
      .then(() => reload([...recent, Date.now()]), () => setTimeout(retry, 1000))
    setTimeout(retry, 500)
  }

  // a bar over the page explaining why it isn't live; null hides it
  private showStatus(text: string | null, button?: { label: string, action: () => void }) {
    let bar = document.getElementById('amaze-connection-status')
    if (!text) {
      bar?.remove()
      return
    }
    if (!bar) {
      bar = document.createElement('div')
      bar.id = 'amaze-connection-status'
      bar.setAttribute('role', 'status')
      bar.style.cssText = 'position:fixed;top:48px;left:50%;transform:translateX(-50%);z-index:1000;display:flex;gap:12px;align-items:center;'
      + 'padding:8px 14px;border-radius:6px;font:13px var(--ab-font, system-ui, sans-serif);color:var(--ab-fg, #ccc);'
      + 'background:var(--vscode-editorWidget-background, #252526);border:1px solid var(--vscode-widget-border, #454545);box-shadow:0 2px 8px rgba(0,0,0,.35)'
      document.body.appendChild(bar)
    }
    bar.replaceChildren(text)
    if (button) {
      const el = document.createElement('button')
      el.textContent = button.label
      el.style.cssText = 'font:inherit;cursor:pointer;padding:3px 10px;border-radius:4px;border:1px solid var(--vscode-widget-border, #454545);'
      + 'background:var(--vscode-button-secondaryBackground, #313131);color:inherit'
      el.onclick = button.action
      bar.appendChild(el)
    }
  }

  onMessage(object: any) {
    if (object) {
      if (object.callbackId) {
        // this.logger.log(`◀ RECV callbackId: ${object.callbackId}`)
        const callback: any = this.callbacks.get(object.callbackId)
        // Callbacks could be all rejected if someone has called `.dispose()`.
        if (callback) {
          this.callbacks.delete(object.callbackId)
          if (object.error)
            callback.reject(object.error, callback.method, object)
          else
            callback.resolve(object.result)
        }
      }
      else {
        // this.logger.log(`◀ RECV method: ${object.method}`)
        this.emit(object.method, object.result)
      }
    }
  }

  enableVerboseLogging(verbose: boolean) {
    if (verbose)
      this.logger.enable()
    else
      this.logger.disable()
  }
}
