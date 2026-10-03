import React from 'react'
import './toolbar.css'

import UrlInput from '../url-input/url-input'
import DeviceSettings from '../device-settings/device-settings'
import Menu from '../menu/menu'
import type { MenuEntry, MenuPosition } from '../menu/menu'
import type { HistoryEntry } from '../../../src/HistoryEntry'
import { ArrowLeftIcon, ArrowRightIcon, DeviceIcon, HistoryIcon, PlusIcon, ReloadIcon, StopIcon } from '../icons/icons'

function hostname(url: string) {
  try {
    return new URL(url).hostname || url
  }
  catch {
    return url
  }
}

interface IToolbarProps {
  canGoBack: boolean
  canGoForward: boolean
  isInspectEnabled: boolean
  isDeviceEmulationEnabled: boolean
  url: string
  viewport: any
  visitedPages: HistoryEntry[]
  // floating panel shown under the toolbar, e.g. the find bar
  overlay?: React.ReactNode
  onActionInvoked: (action: string, data?: object) => Promise<any>
}

interface IToolbarState {
  historyMenuPosition: MenuPosition | null
}

class Toolbar extends React.Component<IToolbarProps, IToolbarState> {
  private viewportMetadata: any
  private historyButtonRef = React.createRef<HTMLButtonElement>()

  constructor(props: any) {
    super(props)
    this.state = { historyMenuPosition: null }

    this.handleBack = this.handleBack.bind(this)
    this.handleForward = this.handleForward.bind(this)
    this.handleRefresh = this.handleRefresh.bind(this)
    this.handleUrlChange = this.handleUrlChange.bind(this)
    this.handleInspect = this.handleInspect.bind(this)
    this.handleEmulateDevice = this.handleEmulateDevice.bind(this)
    this.handleDeviceChange = this.handleDeviceChange.bind(this)
    this.handleViewportSizeChange = this.handleViewportSizeChange.bind(this)
    this.toggleHistoryMenu = this.toggleHistoryMenu.bind(this)
    this.closeHistoryMenu = this.closeHistoryMenu.bind(this)
  }

  public render() {
    this.viewportMetadata = this.props.viewport

    // canGoBack/canGoForward are true when navigation in that direction is NOT possible
    const isLoading = !!this.viewportMetadata?.isLoading

    return (
      <div className="toolbar">
        <div className="toolbar-row">
          <div className="toolbar-group">
            <button
              className="toolbar-button"
              title="Back"
              aria-label="Back"
              onClick={this.handleBack}
              disabled={this.props.canGoBack}
            >
              <ArrowLeftIcon />
            </button>
            <button
              className="toolbar-button"
              title="Forward"
              aria-label="Forward"
              onClick={this.handleForward}
              disabled={this.props.canGoForward}
            >
              <ArrowRightIcon />
            </button>
            <button
              className="toolbar-button"
              title={isLoading ? 'Stop loading' : 'Reload'}
              aria-label={isLoading ? 'Stop loading' : 'Reload'}
              onClick={isLoading ? () => this.props.onActionInvoked('stop') : this.handleRefresh}
            >
              {isLoading ? <StopIcon /> : <ReloadIcon />}
            </button>
          </div>
          <UrlInput
            url={this.props.url}
            onUrlChanged={this.handleUrlChange}
            onActionInvoked={this.props.onActionInvoked}
          />
          <div className="toolbar-group">
            <button
              className={`toolbar-button ${this.state.historyMenuPosition ? 'active' : ''}`}
              title="History"
              aria-label="History"
              aria-haspopup="menu"
              aria-expanded={!!this.state.historyMenuPosition}
              ref={this.historyButtonRef}
              onClick={this.toggleHistoryMenu}
            >
              <HistoryIcon />
            </button>
            <button
              className={`toolbar-button ${this.props.isDeviceEmulationEnabled ? 'active' : ''}`}
              title="Emulate device"
              aria-label="Emulate device"
              aria-pressed={this.props.isDeviceEmulationEnabled}
              onClick={this.handleEmulateDevice}
            >
              <DeviceIcon />
            </button>
            <span className="toolbar-divider" aria-hidden="true" />
            <button
              className="toolbar-button"
              title="New tab"
              aria-label="New tab"
              onClick={() => this.props.onActionInvoked('newTab')}
            >
              <PlusIcon />
            </button>
          </div>
        </div>
        <Menu
          position={this.state.historyMenuPosition}
          items={this.getHistoryMenuItems()}
          onClose={this.closeHistoryMenu}
          ignoreClicksOn={this.historyButtonRef}
        />
        {this.props.overlay}
        <DeviceSettings
          viewportMetadata={this.viewportMetadata}
          isVisible={this.props.isDeviceEmulationEnabled}
          onDeviceChange={this.handleDeviceChange}
          onViewportSizeChange={this.handleViewportSizeChange}
        />
      </div>
    )
  }

  private toggleHistoryMenu() {
    if (this.state.historyMenuPosition) {
      this.closeHistoryMenu()
      return
    }
    const rect = this.historyButtonRef.current!.getBoundingClientRect()
    // anchored at the button's right edge; the menu flips left when it doesn't fit
    this.setState({ historyMenuPosition: { x: rect.right, y: rect.bottom + 4 } })
  }

  private closeHistoryMenu() {
    this.setState({ historyMenuPosition: null })
  }

  private getHistoryMenuItems(): MenuEntry[] {
    const pages = this.props.visitedPages
    const items: MenuEntry[] = pages.length
      ? pages.map(page => ({
        label: page.title || hostname(page.url),
        hint: page.title ? hostname(page.url) : undefined,
        title: page.url,
        action: () => this.handleUrlChange(page.url),
      }))
      : [{ label: 'No history yet', disabled: true }]

    return [
      ...items,
      null,
      { label: 'Clear History and Cookies...', action: () => this.props.onActionInvoked('clearBrowsingData') },
      { label: 'Support Amaze Browser', action: () => this.props.onActionInvoked('support') },
    ]
  }

  private handleUrlChange(url: string) {
    this.props.onActionInvoked('urlChange', { url })
  }

  private handleBack() {
    this.props.onActionInvoked('backward', {})
  }

  private handleForward() {
    this.props.onActionInvoked('forward', {})
  }

  private handleRefresh() {
    this.props.onActionInvoked('refresh', {})
  }

  private handleInspect() {
    this.props.onActionInvoked('inspect', {})
  }

  private handleEmulateDevice() {
    this.props.onActionInvoked('emulateDevice', {})
  }

  private handleViewportSizeChange(viewportSize: any) {
    this.props.onActionInvoked('viewportSizeChange', {
      height: viewportSize.height,
      width: viewportSize.width,
    })
  }

  private handleDeviceChange(device: any) {
    this.props.onActionInvoked('viewportDeviceChange', {
      device,
    })
  }
}

export default Toolbar
