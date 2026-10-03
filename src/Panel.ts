import * as path from 'path'
import type { Disposable, TextDocument } from 'vscode'
import { Position, Selection, Uri, ViewColumn, commands, env, window, workspace } from 'vscode'
import { EventEmitter2 } from 'eventemitter2'

import type { BrowserClient } from './BrowserClient'
import type { BrowserPage } from './BrowserPage'
import type { ExtensionConfiguration } from './ExtensionConfiguration'
import type { HistoryEntry } from './HistoryEntry'
import { getConfig } from './Config'
import { ContentProvider } from './ContentProvider'
import type { PanelView } from './PanelView'
import { WebviewPanelView } from './PanelView'

export type DevToolsPosition = 'right' | 'bottom' | 'left' | 'window'

export class Panel extends EventEmitter2 {
  private static readonly viewType = 'amaze-browser'
  private view: PanelView | null
  public disposables: Disposable[] = []
  public url = ''
  public title = ''
  private state = {}
  private contentProvider: ContentProvider
  public browserPage: BrowserPage | null
  private browser: BrowserClient
  public config: ExtensionConfiguration
  public parentPanel: Panel | undefined
  public debugPanel: Panel | undefined
  public disposed = false
  private initialUrl: string | undefined
  private configured = false

  constructor(config: ExtensionConfiguration, browser: BrowserClient, parentPanel?: Panel) {
    super()
    this.config = config
    this.view = null
    this.browserPage = null
    this.browser = browser
    this.parentPanel = parentPanel
    this.contentProvider = new ContentProvider(this.config)

    if (parentPanel)
      parentPanel.once('disposed', () => this.dispose())
  }

  get isDebugPage() {
    return !!this.parentPanel
  }

  get isRemote() {
    return !!this.view?.isRemote
  }

  // the panel's UI is a new VS Code webview in `target`, or an existing view such as a browser tab
  public async launch(startUrl?: string, target: ViewColumn | PanelView = ViewColumn.Two) {
    try {
      this.browserPage = await this.browser.newPage()
      if (this.browserPage) {
        this.browserPage.else((data: any) => {
          this.view?.postMessage(data)
        })
      }
    }
    catch (err) {
      window.showErrorMessage(err.message)
    }

    // before listening: a browser tab's first message may already be waiting for the configuration
    if (startUrl) {
      this.initialUrl = startUrl
      this.url = this.url || startUrl
    }

    this.view = typeof target === 'object' ? target : this.createWebview(target)
    this.view.onDidDispose(() => this.dispose(), null, this.disposables)
    this.view.onDidChangeActive(active => this.emit(active ? 'focus' : 'blur'), null, this.disposables)
    // a hidden panel keeps its webview alive: tell it to stop the screencast until it's shown again
    this.view.onDidChangeVisible(visible => this.view?.postMessage({ method: 'extension.visibility', result: { visible } }), null, this.disposables)
    this.view.onDidReceiveMessage(
      (msg) => {
        if (msg.type === 'extension.frameDrawn') {
          this.browserPage?.frameDrawn()
          return
        }

        // sent whenever the webview (re)loads, e.g. after being moved to another window
        if (msg.type === 'extension.ready') {
          this.browserPage?.frameDrawn()
          this.sendConfiguration()
          this.emit('ready')
          return
        }

        if (msg.type === 'extension.updateTitle') {
          this.title = msg.params.title
          if (this.view) {
            this.view.setTitle(this.isDebugPage ? `DevTools - ${this.parentPanel.title}` : msg.params.title)
            if (!this.isDebugPage && this.browserPage)
              this.emit('pageVisited', { url: this.browserPage.page.url(), title: msg.params.title })
            try {
              this.view.setIcon(`https://favicon.yandex.net/favicon/${new URL(this.browserPage?.page.url() || '').hostname}`)
            }
            catch (err) {}
            return
          }
        }
        if (msg.type === 'extension.windowOpenRequested') {
          this.emit('windowOpenRequested', { url: msg.params.url })
          this.url = msg.params.url
        }
        if (msg.type === 'extension.openFile')
          this.handleOpenFileRequest(msg.params)

        if (msg.type === 'extension.newTab')
          this.emit('newTabRequested')

        if (msg.type === 'extension.clearBrowsingData')
          this.emit('clearBrowsingDataRequested')

        if (msg.type === 'extension.support')
          this.emit('supportRequested')

        if (msg.type === 'extension.openExternal')
          env.openExternal(Uri.parse(msg.params.url))

        if (msg.type === 'extension.openDevTools')
          this.createDebugPanel().then(panel => panel?.show())

        if (msg.type === 'extension.windowDialogRequested') {
          const { message, type } = msg.params
          if (type == 'alert') {
            window.showInformationMessage(message)
            if (this.browserPage) {
              this.browserPage.send('Page.handleJavaScriptDialog', {
                accept: true,
              })
            }
          }
          else if (type === 'prompt') {
            window
              .showInputBox({ placeHolder: message })
              .then((result) => {
                if (this.browserPage) {
                  this.browserPage.send('Page.handleJavaScriptDialog', {
                    accept: true,
                    promptText: result,
                  })
                }
              })
          }
          else if (type === 'confirm') {
            window.showQuickPick(['Ok', 'Cancel']).then((result) => {
              if (this.browserPage) {
                this.browserPage.send('Page.handleJavaScriptDialog', {
                  accept: result === 'Ok',
                })
              }
            })
          }
        }

        if (msg.type === 'extension.appStateChanged') {
          this.state = msg.params.state
          this.emit('stateChanged')
        }

        if (this.browserPage) {
          try {
            // extension.* messages are handled above, everything else is a CDP command
            if (!msg.type.startsWith('extension.'))
              this.browserPage.send(msg.type, msg.params, msg.callbackId)

            this.emit(msg.type, msg.params)
          }
          catch (err) {
            window.showErrorMessage(err)
          }
        }
      },
      null,
      this.disposables,
    )

    if (!this.isRemote)
      this.emit('focus')
  }

  private createWebview(column: ViewColumn) {
    const panel = window.createWebviewPanel(
      Panel.viewType,
      'Amaze Browser',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          Uri.file(path.join(this.config.extensionPath, 'dist/client')),
        ],
      },
    )
    panel.webview.html = this.contentProvider.getContent(panel.webview)
    return new WebviewPanelView(panel)
  }

  // DevTools for this page, served by Chromium itself
  private get devToolsUrl() {
    if (!this.browserPage)
      return undefined
    const domain = `${this.config.debugHost}:${this.config.debugPort}`
    return `http://${domain}/devtools/inspector.html?ws=${domain}/devtools/page/${this.browserPage.id}&experiments=true`
  }

  private sendConfiguration() {
    const engine = this.browser.engine
    const result: ExtensionConfiguration = {
      ...this.config,
      engineEndpoint: engine && this.browserPage ? { ...engine.endpoint, targetId: this.browserPage.id } : undefined,
    }
    this.view?.postMessage({
      method: 'extension.appConfiguration',
      result: {
        ...result,
        isDebug: this.isDebugPage,
        // a browser tab opens DevTools in a tab of its own
        devToolsUrl: this.isRemote ? this.devToolsUrl : undefined,
        // only navigate on the first load; a reloaded webview keeps the current page
        startUrl: this.configured ? undefined : this.initialUrl,
      },
    })
    this.configured = true
  }

  public navigateTo(url: string) {
    this.view?.postMessage({
      method: 'extension.navigateTo',
      result: {
        url,
      },
    })
    this.url = url
  }

  public async createDebugPanel() {
    if (this.isDebugPage)
      return
    if (this.debugPanel)
      return this.debugPanel

    const panel = new Panel(this.config, this.browser, this)
    this.debugPanel = panel
    panel.on('focus', () => {
      commands.executeCommand('setContext', 'amaze-browser-debug-active', true)
    })
    panel.on('blur', () => {
      commands.executeCommand('setContext', 'amaze-browser-debug-active', false)
    })
    panel.once('disposed', () => {
      commands.executeCommand('setContext', 'amaze-browser-debug-active', false)
      this.debugPanel = undefined
    })
    const position = getConfig<DevToolsPosition>('amaze-browser.devToolsPosition', 'right')!
    const url = this.devToolsUrl!

    // place DevTools relative to this page's editor group
    this.view?.reveal()
    let column = ViewColumn.Beside
    if (position === 'bottom' || position === 'left') {
      await commands.executeCommand(position === 'bottom' ? 'workbench.action.newGroupBelow' : 'workbench.action.newGroupLeft')
      column = ViewColumn.Active
    }

    await panel.launch(url, column)

    if (position === 'window') {
      await commands.executeCommand('workbench.action.moveEditorToNewWindow').then(undefined, () => {
        window.showWarningMessage('Amaze Browser: This version of VS Code cannot open DevTools in a separate window.')
      })
    }
    return panel
  }

  // reopens DevTools at the configured position
  public async moveDevTools() {
    this.debugPanel?.dispose()
    const panel = await this.createDebugPanel()
    panel?.show()
  }

  public reload() {
    this.browserPage?.send('Page.reload')
  }

  public goBackward() {
    this.browserPage?.send('Page.goBackward')
  }

  public goForward() {
    this.browserPage?.send('Page.goForward')
  }

  public getState() {
    return this.state
  }

  public openExternal(close = true) {
    if (this.url) {
      env.openExternal(Uri.parse(this.url))
      if (close)
        this.dispose()
    }
  }

  public postHistory(entries: HistoryEntry[]) {
    this.view?.postMessage({
      method: 'extension.history',
      result: entries,
    })
  }

  public setViewport(viewport: any) {
    this.view?.postMessage({
      method: 'extension.viewport',
      result: viewport,
    })
  }

  public show() {
    this.view?.reveal()
  }

  public dispose() {
    // a view reports its own disposal back here
    if (this.disposed)
      return
    this.disposed = true
    this.view?.dispose()

    if (this.browserPage) {
      this.browserPage.dispose()
      this.browserPage = null
    }
    while (this.disposables.length) {
      const x = this.disposables.pop()
      if (x)
        x.dispose()
    }
    this.emit('disposed')
    this.removeAllListeners()
  }

  private handleOpenFileRequest(params: any) {
    const lineNumber = params.lineNumber
    const columnNumber = params.columnNumber | params.charNumber | 0

    const workspacePath = `${workspace.rootPath || ''}/`
    const relativePath = params.fileName.replace(workspacePath, '')

    workspace.findFiles(relativePath, '', 1).then((file) => {
      if (!file || !file.length)
        return

      const firstFile = file[0]

      // Open document
      workspace.openTextDocument(firstFile).then(
        (document: TextDocument) => {
          // Show the document
          window.showTextDocument(document, ViewColumn.One).then(
            (document) => {
              if (lineNumber) {
                // Adjust line position from 1 to zero-based.
                const pos = new Position(-1 + lineNumber, columnNumber)
                document.selection = new Selection(pos, pos)
              }
            },
            (reason) => {
              window.showErrorMessage(`Failed to show file. ${reason}`)
            },
          )
        },
        (err) => {
          window.showErrorMessage(`Failed to open file. ${err}`)
        },
      )
    })
  }
}
