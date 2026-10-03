import { EventEmitter2 } from 'eventemitter2'
import Logger from './utils/logger'
import { parseFramePacket } from './engineStream'

const SESSION_KEY = 'amaze-browser-session'

export default class Connection extends EventEmitter2 {
  private lastId: number
  private vscode: any
  private callbacks: Map<number, object>
  private logger: Logger
  // outside VS Code (a tab of the user's browser served by the extension's HTTP server)
  private socket: WebSocket | undefined
  private queue: string[] = []
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

    this.postMessage({
      callbackId: id,
      params,
      type: method,
    })

    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject, error: new Error('Unknown'), method })
    })
  }

  // for messages nobody replies to: send() would keep a callback for each of them forever
  notify(method: string, params = {}) {
    this.postMessage({ params, type: method })
  }

  private postMessage(message: object) {
    if (this.vscode)
      this.vscode.postMessage(message)
    else if (this.socket)
      this.post(JSON.stringify(message))
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
    socket.onopen = () => {
      this.queue.forEach(data => socket.send(data))
      this.queue = []
    }
    // frames come as binary packets, the same as the Rust engine's (see engine/src/frame.rs)
    socket.binaryType = 'arraybuffer'
    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer)
        this.emit('extension.screencastFrame', parseFramePacket(event.data))
      else
        this.onMessage(JSON.parse(event.data))
    }
    socket.onclose = (event) => {
      // another tab (e.g. a duplicate of this one) took the session: this one starts its own
      if (event.code === 4000)
        sessionStorage.removeItem(SESSION_KEY)
      this.reloadWhenServerIsBack()
    }
  }

  // the page and its state live in VS Code: once the server answers again, reloading picks them up
  private reloadWhenServerIsBack() {
    const retry = () => fetch('./', { method: 'HEAD', cache: 'no-store' })
      .then(() => location.reload(), () => setTimeout(retry, 1000))
    setTimeout(retry, 500)
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
