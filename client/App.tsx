import React from 'react'
import './App.css'

import { resolve as getElementSourceMetadata } from 'element-to-source'
import type { ExtensionConfiguration } from '../src/ExtensionConfiguration'
import type { ContextMenuInfo } from '../src/ContextMenuInfo'
import type { HistoryEntry } from '../src/HistoryEntry'
import Toolbar from './components/toolbar/toolbar'
import Viewport from './components/viewport/viewport'
import Menu from './components/menu/menu'
import FindBar from './components/find-bar/find-bar'
import type { FindResult } from './utils/findInPage'
import { clearFindExpression, findExpression } from './utils/findInPage'
import type { MenuEntry, MenuPosition } from './components/menu/menu'
import Connection from './connection'
import { CDPHelper } from './utils/cdpHelper'
import { cursorAtExpression } from './utils/cursorAtPoint'
import { nextZoomLevel, previousZoomLevel } from './utils/pageZoom'

interface ElementSource {
  charNumber: number
  columnNumber: number
  fileName: string
  lineNumber: string
}

interface IState {
  format: 'jpeg' | 'png'
  url: string
  quality: number
  errorText: string | undefined
  everyNthFrame: number
  isDebug: boolean
  devToolsUrl?: string
  isVerboseMode: boolean
  isInspectEnabled: boolean
  isDeviceEmulationEnabled: boolean
  pageContextMenu: { info: ContextMenuInfo, position: MenuPosition } | null
  visitedPages: HistoryEntry[]
  isFindOpen: boolean
  findResult: FindResult | null
  viewportMetadata: IViewport
  history: {
    canGoBack: boolean
    canGoForward: boolean
  }
}

interface IViewport {
  height: number | null
  width: number | null
  cursor: string | null
  emulatedDeviceId: string | null
  isLoading: boolean
  isFixedSize: boolean
  isFixedZoom: boolean
  isResizable: boolean
  loadingPercent: number
  highlightNode: {
    nodeId: string
    sourceMetadata: ElementSource | null
  } | null
  deviceSizeRatio: number
  screenZoom: number
  // zoom of the page itself, like a browser's Ctrl+=/Ctrl+-; screenZoom only fits the view to the window
  pageZoom: number
}

class App extends React.Component<any, IState> {
  private connection: Connection
  private viewport: Viewport = undefined!
  private cdpHelper: CDPHelper
  private nextViewportSize: { width: number; height: number } | undefined
  private findBar: FindBar | null = null
  private lastContextMenuPosition: { x: number, y: number } | null = null
  private readonly isMac = /macintosh|mac os x/i.test(navigator.userAgent)
  // the node under the pointer in inspect mode, compared by its stable backend id
  private highlightedBackendNodeId: number | null = null
  // latest pointer position waiting for a cursor lookup, at most one lookup is in flight
  private cursorPosition: { x: number, y: number } | null = null
  private isResolvingCursor = false

  constructor(props: any) {
    super(props)
    this.state = {
      format: 'jpeg',
      url: 'about:blank',
      quality: 80,
      everyNthFrame: 1,
      isVerboseMode: false,
      isDebug: false,
      errorText: undefined,
      isInspectEnabled: false,
      isDeviceEmulationEnabled: false,
      pageContextMenu: null,
      visitedPages: [],
      isFindOpen: false,
      findResult: null,
      history: {
        canGoBack: false,
        canGoForward: false,
      },
      viewportMetadata: {
        cursor: null,
        deviceSizeRatio: 1,
        height: null,
        width: null,
        highlightNode: null,
        emulatedDeviceId: 'Responsive',
        isLoading: false,
        isFixedSize: false,
        isFixedZoom: false,
        isResizable: false,
        loadingPercent: 0.0,
        screenZoom: 1,
        pageZoom: 1,
      },
    }

    this.connection = new Connection()
    this.onToolbarActionInvoked = this.onToolbarActionInvoked.bind(this)
    this.onViewportChanged = this.onViewportChanged.bind(this)
    this.closePageContextMenu = this.closePageContextMenu.bind(this)
    this.handleFind = this.handleFind.bind(this)
    this.closeFind = this.closeFind.bind(this)

    // Ctrl/Cmd+F opens our find bar and Ctrl/Cmd+=/-/0 zoom the page; they must not
    // reach the page or VS Code, which would search or zoom the webview (a screenshot of the page)
    const zoomShortcuts: Record<string, string> = {
      Equal: 'zoomIn',
      NumpadAdd: 'zoomIn',
      Minus: 'zoomOut',
      NumpadSubtract: 'zoomOut',
      Digit0: 'zoomReset',
      Numpad0: 'zoomReset',
    }
    window.addEventListener('keydown', (event) => {
      if (this.state.isDebug || !(event.ctrlKey || event.metaKey) || event.altKey)
        return
      if (event.code === 'KeyF') {
        if (this.state.isFindOpen)
          this.findBar?.focus()
        else
          this.updateState({ isFindOpen: true, findResult: null })
      }
      else if (zoomShortcuts[event.code]) {
        this.onToolbarActionInvoked(zoomShortcuts[event.code], {})
      }
      else {
        return
      }
      event.preventDefault()
      event.stopPropagation()
    }, true)

    // remember where the screencast was right-clicked, the page reports
    // what was under the cursor shortly after ('extension.contextMenu')
    window.addEventListener('contextmenu', (event) => {
      this.lastContextMenuPosition = (event.target as Element)?.classList?.contains('screencast')
        ? { x: event.clientX, y: event.clientY }
        : null
    }, true)

    this.connection.on('extension.history', (visitedPages: HistoryEntry[]) => {
      this.updateState({ visitedPages })
    })

    this.connection.on('extension.contextMenu', (info: ContextMenuInfo) => {
      if (!this.lastContextMenuPosition || this.state.isInspectEnabled)
        return
      this.updateState({ pageContextMenu: { info, position: this.lastContextMenuPosition } })
      this.lastContextMenuPosition = null
    })

    this.connection.enableVerboseLogging(this.state.isVerboseMode)

    this.connection.on('Page.navigatedWithinDocument', (result: any) => {
      this.requestNavigationHistory()
    })

    this.connection.on('extension.appConfiguration', (v) => {
      this.updateState(v)
    })

    this.connection.on('Page.frameNavigated', (result: any) => {
      const { frame } = result
      const isMainFrame = !frame.parentId

      if (isMainFrame) {
        this.requestNavigationHistory()
        this.updateState({
          pageContextMenu: null,
          // the page's highlights are gone after navigating
          findResult: null,
          viewportMetadata: {
            ...this.state.viewportMetadata,
            isLoading: true,
            loadingPercent: 0.1,
          },
          errorText: frame.unreachableUrl
            ? `Failed to reach ${frame.unreachableUrl}`
            : undefined,
        })
      }
    })

    this.connection.on('Page.loadEventFired', (result: any) => {
      // the title is usually only known once the page has loaded
      this.requestNavigationHistory()
      this.updateState({
        viewportMetadata: {
          ...this.state.viewportMetadata,
          loadingPercent: 1.0,
        },
      })

      setTimeout(() => {
        this.updateState({
          viewportMetadata: {
            ...this.state.viewportMetadata,
            isLoading: false,
            loadingPercent: 0,
          },
        })
      }, 500)
    })

    this.connection.on('Page.screencastFrame', (result: any) => {
      this.handleScreencastFrame(result)
    })

    this.connection.on('Page.windowOpen', (result: any) => {
      this.openInNewTab(result.url)
    })

    this.connection.on('Page.javascriptDialogOpening', (result: any) => {
      const { url, message, type } = result

      if (this.connection.isRemote) {
        this.handleDialogNatively(type, message, result.defaultPrompt)
        return
      }

      this.connection.send('extension.windowDialogRequested', {
        url,
        message,
        type,
      })
    })

    this.connection.on('Page.frameResized', (result: any) => {
      this.stopCasting()
      this.startCasting()
    })

    this.connection.on(
      'extension.appConfiguration',
      (payload: ExtensionConfiguration) => {
        if (!payload)
          return

        this.stopCasting()
        this.startCasting()

        if (payload.startUrl)
          this.handleNavigate(payload.startUrl)
      },
    )

    this.connection.on(
      'extension.navigateTo',
      ({ url }: { url: string }) => {
        this.handleNavigate(url)
      },
    )

    this.connection.on('extension.viewport', (viewport: IViewport) => {
      this.handleViewportSizeChange(viewport)
      // this.enableViewportDeviceEmulation('Live Share')
      // TODO: Scroll the page
    })

    // Initialize; DOM and Overlay are only enabled while inspecting, so Chromium
    // doesn't track every node of the page the rest of the time.
    // The screencast starts once the configuration arrives ('extension.appConfiguration').
    this.connection.send('Page.enable')
    // once here and on device changes, not before every navigation
    this.handleSetUserAgent()

    this.requestNavigationHistory()

    this.cdpHelper = new CDPHelper(this.connection)

    // ask for the configuration; also happens when VS Code reloads the webview (e.g. moved to another window)
    this.connection.send('extension.ready')
  }

  private async handleScreencastFrame(result: any) {
    const { sessionId, data } = result

    // the first frame at a new size resizes the view; other frames don't re-render anything
    if (this.nextViewportSize) {
      const size = this.nextViewportSize
      this.nextViewportSize = undefined
      await this.updateState({
        viewportMetadata: { ...this.state.viewportMetadata, ...size },
      })
    }

    // ack only once the frame is ready to show, so Chromium sends the next one
    // when the view can take it, instead of queueing frames that are stale on arrival
    try {
      await this.viewport?.paintFrame(data, this.state.format)
    }
    finally {
      this.connection.send('Page.screencastFrameAck', { sessionId })
    }
  }

  public componentDidUpdate() {
    const { isVerboseMode } = this.state

    this.connection.enableVerboseLogging(isVerboseMode)
  }

  public render() {
    return (
      <div className="App">
        {
          // hide navbar for devtools
          this.state.isDebug
            ? null
            : (
              <Toolbar
                url={this.state.url}
                viewport={this.state.viewportMetadata}
                onActionInvoked={this.onToolbarActionInvoked}
                canGoBack={this.state.history.canGoBack}
                canGoForward={this.state.history.canGoForward}
                isInspectEnabled={this.state.isInspectEnabled}
                isDeviceEmulationEnabled={this.state.isDeviceEmulationEnabled}
                visitedPages={this.state.visitedPages}
                overlay={this.state.isFindOpen && (
                  <FindBar
                    ref={c => this.findBar = c}
                    result={this.state.findResult}
                    onFind={this.handleFind}
                    onClose={this.closeFind}
                  />
                )}
              />
              )
        }
        <Viewport
          viewport={this.state.viewportMetadata}
          isInspectEnabled={this.state.isInspectEnabled}
          isDeviceEmulationEnabled={this.state.isDeviceEmulationEnabled}
          url={this.state.url}
          onActionInvoked={this.onToolbarActionInvoked}
          errorText={this.state.errorText}
          onViewportChanged={this.onViewportChanged}
          ref={c => this.viewport = c!}
        />
        <Menu
          position={this.state.pageContextMenu?.position ?? null}
          items={this.getPageContextMenuItems()}
          onClose={this.closePageContextMenu}
        />
      </div>
    )
  }

  private async handleFind(text: string, backwards: boolean) {
    const response: any = await this.connection.send('Runtime.evaluate', {
      expression: findExpression(text, backwards),
      returnByValue: true,
    })
    this.updateState({ findResult: response?.result?.value ?? { current: 0, total: 0 } })
  }

  private closeFind() {
    this.connection.send('Runtime.evaluate', { expression: clearFindExpression() })
    this.updateState({ isFindOpen: false, findResult: null })
    // give keyboard focus back to the page
    document.querySelector<HTMLElement>('img.screencast')?.focus()
  }

  private closePageContextMenu() {
    if (this.state.pageContextMenu)
      this.updateState({ pageContextMenu: null })
  }

  private getPageContextMenuItems(): MenuEntry[] {
    const info = this.state.pageContextMenu?.info
    if (!info)
      return []

    const mod = this.isMac ? '⌘' : 'Ctrl+'
    const openInNewTab = (url: string) => this.openInNewTab(url)
    // a browser tab is already in the system browser
    const openExternal = (url: string) => this.connection.isRemote
      ? window.open(url, '_blank', 'noopener')
      : this.connection.send('extension.openExternal', { url })
    const copy = (value: string) => this.handleClipboardWrite({ value })
    const evaluate = (expression: string) => this.connection.send('Runtime.evaluate', { expression, userGesture: true })

    const groups: MenuEntry[][] = []

    if (info.linkUrl) {
      groups.push([
        { label: 'Open Link in New Tab', action: () => openInNewTab(info.linkUrl!) },
        { label: 'Open Link in System Browser', action: () => openExternal(info.linkUrl!) },
        { label: 'Copy Link Address', action: () => copy(info.linkUrl!) },
      ])
    }

    if (info.srcUrl) {
      const kind = info.mediaType === 'img' ? 'Image' : info.mediaType === 'video' ? 'Video' : 'Audio'
      groups.push([
        { label: `Open ${kind} in New Tab`, action: () => openInNewTab(info.srcUrl!) },
        { label: `Copy ${kind} Address`, action: () => copy(info.srcUrl!) },
      ])
    }

    const hasSelection = info.selectionText.length > 0
    if (info.isEditable) {
      groups.push([
        {
          label: 'Cut',
          hint: `${mod}X`,
          disabled: !hasSelection,
          action: async () => {
            await copy(info.selectionText)
            evaluate('document.execCommand("delete")')
          },
        },
        { label: 'Copy', hint: `${mod}C`, disabled: !hasSelection, action: () => copy(info.selectionText) },
        {
          label: 'Paste',
          hint: `${mod}V`,
          action: async () => {
            const text = await this.connection.send<string>('Clipboard.readText')
            if (text)
              this.connection.send('Input.insertText', { text })
          },
        },
        { label: 'Select All', hint: `${mod}A`, action: () => evaluate('document.execCommand("selectAll")') },
      ])
    }
    else if (hasSelection) {
      groups.push([
        { label: 'Copy', hint: `${mod}C`, action: () => copy(info.selectionText) },
      ])
    }

    if (!groups.length) {
      groups.push([
        { label: 'Back', hint: this.isMac ? '⌘[' : 'Alt+Left Arrow', action: () => this.onToolbarActionInvoked('backward', {}) },
        { label: 'Forward', hint: this.isMac ? '⌘]' : 'Alt+Right Arrow', action: () => this.onToolbarActionInvoked('forward', {}) },
        { label: 'Reload', hint: `${mod}R`, action: () => this.onToolbarActionInvoked('refresh', {}) },
      ])
      groups.push([
        { label: 'Open Page in System Browser', action: () => openExternal(info.pageUrl) },
        { label: 'Copy Page Address', action: () => copy(info.pageUrl) },
        { label: 'View Page Source', hint: `${mod}U`, action: () => openInNewTab(`view-source:${info.pageUrl}`) },
      ])
    }

    if (!this.state.isDebug)
      groups.push([{ label: 'Open DevTools', action: () => this.openDevTools() }])

    return groups.flatMap((group, i) => i === 0 ? group : [null, ...group])
  }

  // a VS Code panel, or a tab of the user's browser when served by the HTTP server
  private openInNewTab(url: string) {
    if (!this.connection.isRemote) {
      this.connection.send('extension.windowOpenRequested', { url })
      return
    }
    // a popup the page opens without a click can be blocked: then it opens here instead
    if (!window.open(`/?newTab&url=${encodeURIComponent(url)}`, '_blank'))
      this.handleNavigate(url)
  }

  private openDevTools() {
    if (this.connection.isRemote && this.state.devToolsUrl)
      window.open(this.state.devToolsUrl, '_blank', 'noopener')
    else
      this.connection.send('extension.openDevTools')
  }

  // a browser tab shows the page's alert/confirm/prompt as its own
  /* eslint-disable no-alert */
  private handleDialogNatively(type: string, message: string, defaultPrompt?: string) {
    let accept = true
    let promptText: string | undefined
    if (type === 'alert') {
      window.alert(message)
    }
    else if (type === 'prompt') {
      const answer = window.prompt(message, defaultPrompt)
      accept = answer !== null
      promptText = answer ?? undefined
    }
    else {
      // confirm, and beforeunload's "Leave site?"
      accept = window.confirm(message || 'Leave this page? Changes you made may not be saved.')
    }
    this.connection.send('Page.handleJavaScriptDialog', { accept, promptText })
  }
  /* eslint-enable no-alert */

  public stopCasting() {
    this.connection.send('Page.stopScreencast')
  }

  public startCasting(retries = 50) {
    const params = {
      quality: this.state.quality,
      format: this.state.format,
      everyNthFrame: this.state.everyNthFrame,
    }

    // Chromium refuses while the page is mid-navigation ("Not attached to an active page"),
    // e.g. when a resize restarts the screencast right as a page starts loading
    this.connection.send('Page.startScreencast', params).catch(() => {
      if (retries > 0)
        setTimeout(() => this.startCasting(retries - 1), 200)
    })
  }

  private async requestNavigationHistory() {
    const history: any = await this.connection.send(
      'Page.getNavigationHistory',
    )

    if (!history)
      return

    const historyIndex = history.currentIndex
    const historyEntries = history.entries
    const currentEntry = historyEntries[historyIndex]
    const url = currentEntry.url

    this.updateState({
      url,
      history: {
        canGoBack: historyIndex === 0,
        canGoForward: historyIndex === historyEntries.length - 1,
      },
    })

    const panelTitle = currentEntry.title || currentEntry.url

    this.connection.send('extension.updateTitle', {
      title: panelTitle,
    })
    if (this.connection.isRemote)
      document.title = panelTitle
  }

  private async onViewportChanged(action: string, data: any) {
    switch (action) {
      case 'inspectHighlightRequested':
        this.handleInspectHighlightRequested(data)
        break
      case 'inspectElement':
        await this.handleInspectElementRequest(data)
        this.handleToggleInspect()
        break
      case 'hoverElementChanged':
        await this.handleElementChanged(data)
        break
      case 'interaction':
        this.connection.send(data.action, data.params)
        break

      case 'deviceChange':
        await this.updateState({
          viewportMetadata: {
            ...this.state.viewportMetadata,
            ...data,
          },
        })
        this.viewport.calculateViewport()
        break
      case 'size':
        if (data.height !== undefined && data.width !== undefined) {
          this.setDeviceMetrics(data.width, data.height, this.state.viewportMetadata.pageZoom)
          this.nextViewportSize = {
            height: data.height,
            width: data.width,
          }
        }

        break
    }
  }

  // Zooming works like a browser's: the page gets a CSS viewport smaller by the zoom
  // factor and a pixel ratio larger by it, so it re-lays out (media queries and
  // devicePixelRatio follow) while frames keep the size of the view.
  private setDeviceMetrics(width: number, height: number, pageZoom: number) {
    this.connection.send('Page.setDeviceMetricsOverride', {
      deviceScaleFactor: (window.devicePixelRatio || 1) * pageZoom,
      mobile: false,
      height: Math.floor(height / pageZoom),
      width: Math.floor(width / pageZoom),
    })
  }

  private setPageZoom(pageZoom: number) {
    const { width, height } = this.state.viewportMetadata
    if (pageZoom === this.state.viewportMetadata.pageZoom)
      return

    this.updateState({
      viewportMetadata: { ...this.state.viewportMetadata, pageZoom },
    })
    if (width && height)
      this.setDeviceMetrics(width, height, pageZoom)
  }

  private async updateState(newState: Partial<IState>) {
    return new Promise<void>((resolve) => {
      this.setState(newState as any, resolve)
    })
  }

  private async handleInspectHighlightRequested(data: any) {
    const highlightNodeInfo: any = await this.connection.send(
      'DOM.getNodeForLocation',
      {
        x: data.params.position.x,
        y: data.params.position.y,
      },
    )

    if (highlightNodeInfo) {
      // same node as before: the page keeps the highlight on it by itself
      if (highlightNodeInfo.backendNodeId === this.highlightedBackendNodeId)
        return
      this.highlightedBackendNodeId = highlightNodeInfo.backendNodeId

      let nodeId = highlightNodeInfo.nodeId

      if (!highlightNodeInfo.nodeId && highlightNodeInfo.backendNodeId) {
        nodeId = await this.cdpHelper.getNodeIdFromBackendId(
          highlightNodeInfo.backendNodeId,
        )
      }

      this.setState({
        viewportMetadata: {
          ...this.state.viewportMetadata,
          highlightNode: {
            nodeId,
            sourceMetadata: null,
          },
        },
      })

      this.requestNodeHighlighting()
    }
  }

  private async resolveHighlightNodeSourceMetadata() {
    if (!this.state.viewportMetadata.highlightNode)
      return

    const nodeId = this.state.viewportMetadata.highlightNode.nodeId
    const nodeDetails: any = await this.connection.send('DOM.resolveNode', {
      nodeId,
    })

    if (nodeDetails.object) {
      const objectId = nodeDetails.object.objectId
      const nodeProperties = await this.cdpHelper.resolveElementProperties(
        objectId,
        3,
      )

      if (nodeProperties) {
        const sourceMetadata = getElementSourceMetadata(nodeProperties)

        if (!sourceMetadata.fileName)
          return

        this.setState({
          viewportMetadata: {
            ...this.state.viewportMetadata,
            highlightNode: {
              ...this.state.viewportMetadata.highlightNode,
              sourceMetadata: {
                fileName: sourceMetadata.fileName,
                columnNumber: sourceMetadata.columnNumber,
                lineNumber: sourceMetadata.lineNumber,
                charNumber: sourceMetadata.charNumber,
              },
            },
          },
        })
      }
    }
  }

  private async handleInspectElementRequest(data: any) {
    if (!this.state.viewportMetadata.highlightNode)
      return

    await this.resolveHighlightNodeSourceMetadata()

    const nodeId = this.state.viewportMetadata.highlightNode.nodeId

    // Trigger CDP request to enable DOM explorer
    // TODO: No sure this works.
    this.connection.send('Overlay.inspectNodeRequested', {
      nodeId,
    })

    const sourceMetadata = this.state.viewportMetadata.highlightNode
      .sourceMetadata

    if (sourceMetadata) {
      this.connection.send('extension.openFile', {
        fileName: sourceMetadata.fileName,
        lineNumber: sourceMetadata.lineNumber,
        columnNumber: sourceMetadata.columnNumber,
        charNumber: sourceMetadata.charNumber,
      })
    }
  }

  private onToolbarActionInvoked(action: string, data: any): Promise<any> {
    switch (action) {
      case 'forward':
        this.connection.send('Page.goForward')
        break
      case 'backward':
        this.connection.send('Page.goBackward')
        break
      case 'refresh':
        this.connection.send('Page.reload')
        break
      case 'stop':
        this.connection.send('Page.stopLoading')
        this.updateState({
          viewportMetadata: { ...this.state.viewportMetadata, isLoading: false, loadingPercent: 0 },
        })
        break
      case 'inspect':
        this.handleToggleInspect()
        break
      case 'zoomIn':
        this.setPageZoom(nextZoomLevel(this.state.viewportMetadata.pageZoom))
        break
      case 'zoomOut':
        this.setPageZoom(previousZoomLevel(this.state.viewportMetadata.pageZoom))
        break
      case 'zoomReset':
        this.setPageZoom(1)
        break
      case 'emulateDevice':
        this.handleToggleDeviceEmulation()
        break
      case 'urlChange':
        this.handleNavigate(data.url)
        break
      case 'newTab':
        if (this.connection.isRemote)
          window.open('/?newTab', '_blank')
        else
          this.connection.send('extension.newTab')
        break
      case 'clearBrowsingData':
        this.connection.send('extension.clearBrowsingData')
        break
      case 'support':
        this.connection.send('extension.support')
        break
      case 'readClipboard':
        return this.connection.send('Clipboard.readText')
      case 'writeClipboard':
        this.handleClipboardWrite(data)
        break
      case 'viewportSizeChange':
        this.handleViewportSizeChange(data)
        break
      case 'viewportDeviceChange':
        this.handleViewportDeviceChange(data)
        break
    }
    // return an empty promise
    return Promise.resolve()
  }

  private handleToggleInspect() {
    this.highlightedBackendNodeId = null

    if (this.state.isInspectEnabled) {
      // Hide browser highlight
      this.connection.send('Overlay.hideHighlight')
      this.connection.send('Overlay.disable')
      this.connection.send('DOM.disable')

      // Hide local highlight
      this.updateState({
        isInspectEnabled: false,
        viewportMetadata: {
          ...this.state.viewportMetadata,
          highlightNode: null,
        },
      })
    }
    else {
      this.connection.send('DOM.enable')
      this.connection.send('Overlay.enable')
      this.updateState({
        isInspectEnabled: true,
      })
    }
  }

  private async handleNavigate(url: string) {
    const data: any = await this.connection.send('Page.navigate', { url })
    this.setState({ url, errorText: data.errorText })
  }

  private async handleSetUserAgent(userAgent: string = navigator.userAgent) {
    return this.connection.send('Network.setUserAgentOverride', { userAgent })
  }

  private handleViewportSizeChange(data: any) {
    this.onViewportChanged('size', {
      width: data.width,
      height: data.height,
    })
  }

  private handleViewportDeviceChange(data: any) {
    const isResizable = data.device.name === 'Responsive'
    const isFixedSize = data.device.name !== 'Responsive'
    const isFixedZoom = data.device.name === 'Responsive'
    const screenZoom = 1

    this.onViewportChanged('deviceChange', {
      emulatedDeviceId: data.device.name,
      isResizable,
      isFixedSize,
      isFixedZoom,
      screenZoom,
    })

    if (data.device.viewport) {
      this.onViewportChanged('size', {
        width: data.device.viewport.width,
        height: data.device.viewport.height,
      })
    }

    this.handleSetUserAgent(data.device.userAgent)
  }

  private handleToggleDeviceEmulation() {
    if (this.state.isDeviceEmulationEnabled)
      this.disableViewportDeviceEmulation()
    else
      this.enableViewportDeviceEmulation()
  }

  private disableViewportDeviceEmulation() {
    // console.log('app.disableViewportDeviceEmulation')
    this.handleViewportDeviceChange({
      device: {
        name: 'Responsive',
        viewport: {
          width: this.state.viewportMetadata.width,
          height: this.state.viewportMetadata.height,
        },
      },
    })
    this.updateState({
      isDeviceEmulationEnabled: false,
    })
  }

  private enableViewportDeviceEmulation(deviceName = 'Responsive') {
    // console.log('app.enableViewportDeviceEmulation')
    this.handleViewportDeviceChange({
      device: {
        name: deviceName,
        viewport: {
          width: this.state.viewportMetadata.width,
          height: this.state.viewportMetadata.height,
        },
      },
    })
    this.updateState({
      isDeviceEmulationEnabled: true,
    })
  }

  private handleClipboardWrite(data: any) {
    // overwrite the clipboard only if there is a valid value
    if (data && (data as any).value)
      return this.connection.send('Clipboard.writeText', data)
  }

  private async handleElementChanged(data: any) {
    this.cursorPosition = data.params.position
    if (this.isResolvingCursor)
      return

    this.isResolvingCursor = true
    try {
      // positions that arrive during a lookup collapse into one more lookup for the latest
      while (this.cursorPosition) {
        const { x, y } = this.cursorPosition
        this.cursorPosition = null
        const response: any = await this.connection.send('Runtime.evaluate', {
          expression: cursorAtExpression(x, y),
          returnByValue: true,
          silent: true,
        })
        const cursor = response?.result?.value ?? null
        if (cursor !== this.state.viewportMetadata.cursor) {
          this.updateState({
            viewportMetadata: { ...this.state.viewportMetadata, cursor },
          })
        }
      }
    }
    catch {
      // e.g. the page navigated away mid-lookup; the next move tries again
    }
    finally {
      this.isResolvingCursor = false
    }
  }

  private requestNodeHighlighting() {
    if (this.state.viewportMetadata.highlightNode) {
      const nodeId = this.state.viewportMetadata.highlightNode.nodeId

      // Trigger hightlight in regular browser.
      this.connection.send('Overlay.highlightNode', {
        nodeId,
        highlightConfig: {
          showInfo: true,
          showStyles: true,
          showRulers: true,
          showExtensionLines: true,
          contentColor: { r: 111, g: 168, b: 220, a: 0.66 },
          paddingColor: { r: 147, g: 196, b: 125, a: 0.55 },
          borderColor: { r: 255, g: 229, b: 153, a: 0.66 },
          marginColor: { r: 246, g: 178, b: 107, a: 0.66 },
        },
      })
    }
  }
}

export default App
