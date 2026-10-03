import { Buffer } from 'buffer'
import EventEmitterEnhancer, { EnhancedEventEmitter } from 'event-emitter-enhancer'
import type { Browser, CDPSession, Page } from 'puppeteer-core'
import type { Protocol } from 'devtools-protocol'
import { window, workspace } from 'vscode'
import { Clipboard } from './Clipboard'
import { isDarkTheme } from './Config'
import type { ContextMenuInfo } from './ContextMenuInfo'

enum ExposedFunc {
  EmitCopy = 'EMIT_AMAZE_BROWSER_ON_COPY',
  GetPaste = 'EMIT_AMAZE_BROWSER_GET_PASTE',
  EnableCopyPaste = 'ENABLE_AMAZE_BROWSER_HOOK_COPY_PASTE',
  EmitContextMenu = 'EMIT_AMAZE_BROWSER_ON_CONTEXT_MENU',
}

// a webview that stops reporting drawn frames (e.g. reloaded mid-frame) must not freeze the stream
const FRAME_DRAWN_TIMEOUT = 1000

export class BrowserPage extends EnhancedEventEmitter {
  private client: CDPSession
  private clipboard: Clipboard
  // latest frame not yet sent to the webview; newer frames overwrite it so the view never lags behind
  private pendingFrame: Protocol.Page.ScreencastFrameEvent | null = null
  private frameSentAt = 0
  private droppedFrames = 0

  constructor(
    public readonly browser: Browser,
    public readonly page: Page,
  ) {
    super()
    this.clipboard = new Clipboard()
  }

  get id(): string {
    return this.page.mainFrame()._id
  }

  public dispose() {
    this.removeAllElseListeners()
    // @ts-expect-error
    this.removeAllListeners()
    this.client.detach()
    Promise.allSettled([
      this.page.removeExposedFunction(ExposedFunc.EnableCopyPaste),
      this.page.removeExposedFunction(ExposedFunc.EmitCopy),
      this.page.removeExposedFunction(ExposedFunc.GetPaste),
      this.page.removeExposedFunction(ExposedFunc.EmitContextMenu),
    ]).then(() => {
      this.page.close()
    })
  }

  public async send(action: string, data: object = {}, callbackId?: number) {
    // console.log('► browserPage.send', action)
    switch (action) {
      case 'Page.goForward':
        await this.page.goForward()
        break
      case 'Page.goBackward':
        await this.page.goBack()
        break
      case 'Clipboard.readText':
        try {
          this.emit({
            callbackId,
            result: await this.clipboard.readText(),
          } as any)
        }
        catch (e) {
          this.emit({
            callbackId,
            error: e.message,
          } as any)
        }
        break
      case 'Clipboard.writeText':
        try {
          await this.clipboard.writeText((data as { value: string }).value)
          this.emit({ callbackId, result: undefined } as any)
        }
        catch (e) {
          this.emit({ callbackId, error: e.message } as any)
        }
        break
      default:
        this.client
          .send(action as any, data)
          .then((result: any) => {
            this.emit({
              callbackId,
              result,
            } as any)
          })
          .catch((err: any) => {
            this.emit({
              callbackId,
              error: err.message,
            } as any)
          })
    }
  }

  public async launch(): Promise<void> {
    await Promise.allSettled([
      // TODO setting for enable sync copy and paste
      this.page.exposeFunction(ExposedFunc.EnableCopyPaste, () => true),
      this.page.exposeFunction(ExposedFunc.EmitCopy, (text: string) => this.clipboard.writeText(text)),
      this.page.exposeFunction(ExposedFunc.GetPaste, () => this.clipboard.readText()),
      this.page.exposeFunction(ExposedFunc.EmitContextMenu, (info: ContextMenuInfo) => {
        this.emit({ method: 'extension.contextMenu', result: info } as any)
      }),
    ])
    this.page.evaluateOnNewDocument(() => {
      // custom embedded devtools
      // (newer DevTools versions use kebab-case setting names)
      localStorage.setItem('screencastEnabled', 'false')
      localStorage.setItem('screencast-enabled', 'false')
      localStorage.setItem('panel-selectedTab', 'console')
      localStorage.setItem('panel-selected-tab', 'console')

      // sync copy and paste
      if (window[ExposedFunc.EnableCopyPaste]?.()) {
        const copyHandler = (event: ClipboardEvent) => {
          const text = event.clipboardData?.getData('text/plain') || document.getSelection()?.toString()
          text && window[ExposedFunc.EmitCopy]?.(text)
        }
        document.addEventListener('copy', copyHandler)
        document.addEventListener('cut', copyHandler)
        document.addEventListener('paste', async (event) => {
          event.preventDefault()
          const text = await window[ExposedFunc.GetPaste]?.()
          text && document.execCommand('insertText', false, text)
        })
      }
    })

    this.page.evaluateOnNewDocument(() => {
      // headless Chromium has no native context menu, report what was clicked
      // so the webview can render its own (unless the page shows a custom one)
      window.addEventListener('contextmenu', (event) => {
        setTimeout(() => {
          if (event.defaultPrevented || !(event.target instanceof Element))
            return
          const target = event.target
          const link = target.closest('a[href]') as HTMLAnchorElement | null
          const media = target.closest('img, video, audio') as HTMLImageElement | HTMLMediaElement | null
          const field = target.closest('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null
          const isEditable = (!!field && !field.readOnly && !field.disabled) || (target as HTMLElement).isContentEditable
          let selectionText = document.getSelection()?.toString() || ''
          if (field && typeof field.selectionStart === 'number')
            selectionText = field.value.slice(field.selectionStart, field.selectionEnd ?? field.selectionStart)
          window[ExposedFunc.EmitContextMenu]?.({
            pageUrl: location.href,
            linkUrl: link?.href,
            srcUrl: media ? (media.currentSrc || media.src) : undefined,
            mediaType: media?.tagName.toLowerCase(),
            selectionText,
            isEditable,
          })
        })
      })
    })

    this.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: isDarkTheme() ? 'dark' : 'light' }])

    this.client = await this.page.target().createCDPSession()

    // @ts-expect-error
    EventEmitterEnhancer.modifyInstance(this.client)

    // @ts-expect-error
    this.client.else((action: string, data: object) => {
      // console.log('◀ browserPage.received', action)
      this.emit({
        method: action,
        result: data,
      } as any)
    })

    // ack right away: Chromium drops frames while 3 are unacked, so acking from the webview capped the fps
    this.client.on('Page.screencastFrame', (frame: Protocol.Page.ScreencastFrameEvent) => {
      this.client.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
      if (this.pendingFrame)
        this.droppedFrames++
      this.pendingFrame = frame
      this.flushFrame()
    })

    // headless Chromium has no file dialog: show VS Code's instead when a page asks for files
    await this.client.send('Page.enable')
    await this.client.send('Page.setInterceptFileChooserDialog', { enabled: true })
    this.client.on('Page.fileChooserOpened', e => this.handleFileChooser(e).catch((err) => {
      window.showErrorMessage(`Amaze Browser: Failed to upload files: ${err instanceof Error ? err.message : err}`)
    }))
  }

  // the webview drew the last frame (or reloaded): it can take the next one
  public frameDrawn() {
    this.frameSentAt = 0
    this.flushFrame()
  }

  // sends the pending frame unless the webview is still drawing the previous one
  private flushFrame() {
    const frame = this.pendingFrame
    if (!frame || (this.frameSentAt && Date.now() - this.frameSentAt < FRAME_DRAWN_TIMEOUT))
      return
    this.pendingFrame = null
    this.frameSentAt = Date.now()

    // binary instead of base64: VS Code transfers ArrayBuffers to webviews without serializing them
    const buffer = Buffer.from(frame.data, 'base64')
    const data = buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength
      ? buffer.buffer
      : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    this.emit({
      method: 'extension.screencastFrame',
      result: { data, metadata: frame.metadata, droppedFrames: this.droppedFrames },
    } as any)
  }

  private async handleFileChooser({ backendNodeId, mode }: Protocol.Page.FileChooserOpenedEvent) {
    if (!backendNodeId)
      return

    const { node } = await this.client.send('DOM.describeNode', { backendNodeId })
    const attributes = node.attributes || []
    const accept = attributes[attributes.indexOf('accept') + 1] ?? ''
    const extensions = acceptToExtensions(attributes.includes('accept') ? accept : '')

    const files = await window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: mode === 'selectMultiple',
      defaultUri: workspace.workspaceFolders?.[0]?.uri,
      openLabel: 'Upload',
      title: 'Choose files to upload',
      filters: extensions.length ? { 'Accepted files': extensions, 'All files': ['*'] } : undefined,
    })
    // cancelled: leave the input untouched, like a browser does
    if (!files?.length)
      return

    await this.client.send('DOM.setFileInputFiles', { backendNodeId, files: files.map(f => f.fsPath) })
  }
}

const MIME_EXTENSIONS: Record<string, string[]> = {
  'image/*': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'],
  'video/*': ['mp4', 'webm', 'mov', 'mkv', 'avi'],
  'audio/*': ['mp3', 'wav', 'ogg', 'm4a', 'flac'],
  'application/pdf': ['pdf'],
  'application/json': ['json'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
}

// Turns an <input accept="..."> value into file-extension filters for the dialog
function acceptToExtensions(accept: string) {
  const extensions = new Set<string>()
  for (const token of accept.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)) {
    if (token.startsWith('.'))
      extensions.add(token.slice(1))
    else
      MIME_EXTENSIONS[token]?.forEach(e => extensions.add(e))
  }
  return [...extensions]
}
