import type { ExtensionContext, Uri } from 'vscode'
import { ConfigurationTarget, commands, window, workspace } from 'vscode'
import * as EventEmitter from 'eventemitter2'

import { BrowserClient, clearSavedCookies } from './BrowserClient'
import { History } from './History'
import { getConfig, getConfigs } from './Config'
import { Panel } from './Panel'
import { SupportPrompt } from './SupportPrompt'
import type { DevToolsPosition } from './Panel'
import type { PanelView } from './PanelView'
import type { ExtensionConfiguration } from './ExtensionConfiguration'

export class PanelManager extends EventEmitter.EventEmitter2 {
  public panels: Set<Panel>
  public current: Panel | undefined
  public browser: BrowserClient
  public config: ExtensionConfiguration
  public readonly history: History
  public readonly supportPrompt: SupportPrompt

  constructor(public readonly ctx: ExtensionContext) {
    super()
    this.panels = new Set()
    this.config = getConfigs(this.ctx)
    this.history = new History(ctx.globalState)
    this.history.on('changed', entries => this.panels.forEach(p => p.postHistory(entries)))
    this.supportPrompt = new SupportPrompt(ctx)
    ctx.subscriptions.push(this.supportPrompt)

    this.on('windowOpenRequested', (params) => {
      this.create(params.url)
    })
  }

  private async refreshSettings() {
    const prev = this.config

    this.config = {
      ...getConfigs(this.ctx),
      debugPort: prev.debugPort,
    }
  }

  // `view` is where the panel shows, e.g. a browser tab; a new webview by default
  public async create(startUrl: string | Uri = this.config.startUrl, view?: PanelView) {
    this.refreshSettings()

    if (!this.browser)
      this.browser = new BrowserClient(this.config, this.ctx)

    const panel = new Panel(this.config, this.browser)

    panel.once('disposed', () => {
      if (this.current === panel) {
        this.current = undefined
        commands.executeCommand('setContext', 'amaze-browser-active', false)
      }
      this.panels.delete(panel)
      if (this.panels.size === 0) {
        this.browser.dispose()
        this.browser = null
      }

      this.emit('windowDisposed', panel)
    })

    panel.on('windowOpenRequested', (params) => {
      this.emit('windowOpenRequested', params)
    })

    panel.on('newTabRequested', () => this.create())
    panel.on('clearBrowsingDataRequested', () => this.clearBrowsingData())
    panel.on('pageVisited', ({ url, title }) => {
      this.history.add(url, title)
      this.supportPrompt.pageLoaded()
    })
    panel.on('supportRequested', () => this.supportPrompt.show())
    panel.on('ready', () => panel.postHistory(this.history.list()))

    panel.on('focus', () => {
      this.current = panel
      commands.executeCommand('setContext', 'amaze-browser-active', true)
    })

    panel.on('blur', () => {
      if (this.current === panel) {
        this.current = undefined
        commands.executeCommand('setContext', 'amaze-browser-active', false)
      }
    })

    this.panels.add(panel)

    await panel.launch(startUrl.toString(), view)

    this.emit('windowCreated', panel)

    this.ctx.subscriptions.push({
      dispose: () => panel.dispose(),
    })

    return panel
  }

  public async createFile(filepath: string) {
    if (!filepath)
      return

    const panel = await this.create(`file://${filepath}`)
    if (getConfig('amaze-browser.localFileAutoReload')) {
      panel.disposables.push(
        workspace.createFileSystemWatcher(filepath, true, false, false).onDidChange(() => {
        // TODO: check filename
          panel.reload()
        }),
      )
    }
    return panel
  }

  public async moveDevTools() {
    const positions: { label: string, description: string, value: DevToolsPosition }[] = [
      { label: '$(layout-sidebar-right) Right', description: 'Next to the page', value: 'right' },
      { label: '$(layout-panel) Bottom', description: 'Below the page', value: 'bottom' },
      { label: '$(layout-sidebar-left) Left', description: 'Before the page', value: 'left' },
      { label: '$(window) Separate Window', description: 'In its own VS Code window', value: 'window' },
    ]
    const current = getConfig<DevToolsPosition>('amaze-browser.devToolsPosition', 'right')
    const picked = await window.showQuickPick(
      positions.map(p => ({ ...p, detail: p.value === current ? 'Current position' : undefined })),
      { placeHolder: 'Where should DevTools open?' },
    )
    if (!picked)
      return

    // remembered for the next time DevTools opens
    await workspace.getConfiguration('amaze-browser').update('devToolsPosition', picked.value, ConfigurationTarget.Global)

    const panels = [...this.panels]
    const target = this.current?.debugPanel ? this.current : panels.find(p => p.debugPanel)
    if (target)
      await target.moveDevTools()
  }

  public async showHistory() {
    const entries = this.history.list()
    const clearItem = { label: '$(trash) Clear History and Cookies...', url: '' }
    const supportItem = { label: '$(heart) Support Amaze Browser', url: '' }
    const picked = await window.showQuickPick(
      [
        ...entries.map(e => ({ label: e.title || e.url, description: e.title ? e.url : undefined, url: e.url })),
        clearItem,
        supportItem,
      ],
      { placeHolder: entries.length ? 'Recently visited pages' : 'No history yet' },
    )
    if (!picked)
      return
    if (picked === clearItem)
      return this.clearBrowsingData()
    if (picked === supportItem)
      return this.supportPrompt.show()
    if (this.current)
      this.current.navigateTo(picked.url)
    else
      await this.create(picked.url)
  }

  public async clearBrowsingData() {
    const confirm = 'Clear'
    const answer = await window.showWarningMessage(
      'Delete all browsing history and cookies?',
      { modal: true, detail: 'You will be signed out of websites opened in Amaze Browser.' },
      confirm,
    )
    if (answer !== confirm)
      return

    try {
      await this.history.clear()
      if (this.browser)
        await this.browser.clearCookies()
      else
        await clearSavedCookies(this.ctx)
      window.showInformationMessage('Amaze Browser: History and cookies cleared.')
    }
    catch (e) {
      window.showErrorMessage(`Amaze Browser: Failed to clear cookies: ${e instanceof Error ? e.message : e}`)
    }
  }

  public disposeByUrl(url: string) {
    this.panels.forEach((b: Panel) => {
      if (b.config.startUrl === url)
        b.dispose()
    })
  }
}
