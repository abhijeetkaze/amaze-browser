import type { Buffer } from 'buffer'
import { readFile } from 'fs/promises'
import type { IncomingMessage, Server, ServerResponse } from 'http'
import { createServer } from 'http'
import { extname, join, normalize, sep } from 'path'
import type { WebSocket } from 'ws'
import { WebSocketServer } from 'ws'
import { isDarkTheme } from './Config'
import { SocketView } from './PanelView'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

// Names the page is reachable by. Checking them stops DNS rebinding, where a
// website re-points its own domain at 127.0.0.1 to reach this server
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

function isLocalHost(host: string | undefined) {
  return !!host && LOCAL_HOSTNAMES.has(host.replace(/:\d+$/, ''))
}

// "host[:port]" of an http(s) origin, or undefined for anything else
function originHost(origin: string | undefined) {
  const match = origin?.match(/^https?:\/\/([^/]+)$/)
  return match?.[1].toLowerCase()
}

// The webview gets VS Code's theme variables; a browser tab gets the defaults of VS Code's own themes
function themeStyle() {
  const dark = isDarkTheme()
  const vars: Record<string, string> = dark
    ? {
        'font-family': 'system-ui, -apple-system, "Segoe UI", Ubuntu, sans-serif',
        'foreground': '#cccccc',
        'descriptionForeground': '#9d9d9d',
        'errorForeground': '#f85149',
        'focusBorder': '#0078d4',
        'editor-background': '#1f1f1f',
        'editorWidget-background': '#202020',
        'editorGroup-border': '#ffffff17',
        'tab-activeBackground': '#1f1f1f',
        'input-background': '#313131',
        'input-border': '#3c3c3c',
        'toolbar-hoverBackground': '#5a5d5e50',
        'toolbar-activeBackground': '#63666750',
        'widget-border': '#313131',
        'widget-shadow': '#0000005c',
        'menu-background': '#1f1f1f',
        'menu-foreground': '#cccccc',
        'menu-border': '#454545',
        'menu-selectionBackground': '#0078d4',
        'menu-selectionForeground': '#ffffff',
        'menu-separatorBackground': '#454545',
        'button-secondaryBackground': '#313131',
        'button-secondaryHoverBackground': '#3c3c3c',
      }
    : {
        'font-family': 'system-ui, -apple-system, "Segoe UI", Ubuntu, sans-serif',
        'foreground': '#3b3b3b',
        'descriptionForeground': '#3b3b3b',
        'errorForeground': '#f85149',
        'focusBorder': '#005fb8',
        'editor-background': '#ffffff',
        'editorWidget-background': '#f8f8f8',
        'editorGroup-border': '#e5e5e5',
        'tab-activeBackground': '#ffffff',
        'input-background': '#ffffff',
        'input-border': '#cecece',
        'toolbar-hoverBackground': '#b8b8b850',
        'toolbar-activeBackground': '#a6a6a650',
        'widget-border': '#e5e5e5',
        'widget-shadow': '#00000029',
        'menu-background': '#ffffff',
        'menu-foreground': '#3b3b3b',
        'menu-border': '#cecece',
        'menu-selectionBackground': '#005fb8',
        'menu-selectionForeground': '#ffffff',
        'menu-separatorBackground': '#e5e5e5',
        'button-secondaryBackground': '#e5e5e5',
        'button-secondaryHoverBackground': '#cccccc',
      }
  const declarations = Object.entries(vars).map(([name, value]) => `--vscode-${name}: ${value};`).join(' ')
  return `<style>:root { color-scheme: ${dark ? 'dark' : 'light'}; ${declarations} }</style>`
}

/**
 * Serves the Amaze Browser UI on localhost, so the user's own browser can show and drive
 * the pages: each tab that connects gets a page, like a panel in VS Code.
 */
export class HttpServer {
  private readonly server: Server
  private readonly sockets = new WebSocketServer({ noServer: true })
  // session id (kept by the tab across reloads) → its view
  private readonly sessions = new Map<string, SocketView>()
  private readonly root: string
  // the address VS Code forwards this server to, e.g. name-8100.app.github.dev with Codespaces
  private forwardedHost: string | undefined

  constructor(extensionPath: string, private readonly onSession: (view: SocketView, url: string | undefined) => void) {
    this.root = join(extensionPath, 'dist', 'client')
    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch(() => {
        if (!res.headersSent)
          res.writeHead(500)
        res.end()
      })
    })
    this.server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '/', 'http://localhost')
      if (url.pathname !== '/ws' || !this.isOwnOrigin(req)) {
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
        return
      }
      this.sockets.handleUpgrade(req, socket, head, ws => this.handleSocket(ws, url.searchParams))
    })
  }

  listen(port: number) {
    return new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      // loopback only: the browser behind this server has the user's cookies and local files
      this.server.listen(port, '127.0.0.1', () => {
        this.server.off('error', reject)
        resolve()
      })
    })
  }

  // with VS Code Remote the page is opened through this address (http or https) as well
  allowForwardedAddress(authority: string) {
    if (!isLocalHost(authority))
      this.forwardedHost = authority.toLowerCase()
  }

  // Names the page may be requested by: anything else is a website that re-pointed its domain here
  private isAllowedHost(host: string | undefined) {
    return isLocalHost(host) || (!!host && host.toLowerCase() === this.forwardedHost)
  }

  // Browsers let any website open a WebSocket to localhost: only this server's own page may,
  // otherwise any site the user visits could drive the browser (and read its pages and cookies).
  // A forwarding proxy may pass the public Host on, or replace it with localhost
  private isOwnOrigin(req: IncomingMessage) {
    const origin = originHost(req.headers.origin)
    return this.isAllowedHost(req.headers.host)
      && !!origin
      && (origin === req.headers.host?.toLowerCase() || origin === this.forwardedHost)
  }

  get port() {
    const address = this.server.address()
    return typeof address === 'object' && address ? address.port : undefined
  }

  dispose() {
    this.sessions.forEach(view => view.dispose())
    this.sessions.clear()
    this.sockets.close()
    this.server.close()
    this.server.closeAllConnections?.()
  }

  private handleSocket(ws: WebSocket, params: URLSearchParams) {
    const sessionId = params.get('session') || ''
    const existing = this.sessions.get(sessionId)
    if (existing?.alive) {
      existing.attach(ws)
      return
    }

    const view = new SocketView(ws)
    if (/^[\w-]{8,64}$/.test(sessionId)) {
      this.sessions.set(sessionId, view)
      view.onDidDispose(() => {
        if (this.sessions.get(sessionId) === view)
          this.sessions.delete(sessionId)
      })
    }
    this.onSession(view, params.get('url') || undefined)
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    if (!this.isAllowedHost(req.headers.host) || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(403).end()
      return
    }

    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname)
    const file = normalize(join(this.root, pathname === '/' ? 'index.html' : pathname))
    if (!file.startsWith(this.root + sep)) {
      res.writeHead(404).end()
      return
    }

    let body: Buffer | string
    try {
      body = await readFile(file)
    }
    catch {
      res.writeHead(404).end()
      return
    }
    if (pathname === '/')
      body = body.toString().replace('</head>', `${themeStyle()}</head>`)

    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(file)] || 'application/octet-stream',
      // the page is only for this machine; never let other sites frame it
      'X-Frame-Options': 'DENY',
      'Cache-Control': pathname.startsWith('/assets/') ? 'max-age=31536000, immutable' : 'no-cache',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}
