import type { ExtensionContext } from 'vscode'
import { StatusBarAlignment, Uri, commands, debug, env, window } from 'vscode'

import { DebugProvider } from './DebugProvider'
import { ensureChromium } from './ChromiumDownloader'
import { getConfig } from './Config'
import { HttpServer } from './HttpServer'
import { PanelManager } from './PanelManager'

export function activate(ctx: ExtensionContext) {
  const manager = new PanelManager(ctx)
  const debugProvider = new DebugProvider(manager)

  // serves the browser UI to the user's own browser, e.g. http://localhost:8100
  let server: HttpServer | undefined
  let serverUrl: Uri | undefined
  const serverStatus = window.createStatusBarItem(StatusBarAlignment.Right)
  serverStatus.command = 'amaze-browser.openServerInBrowser'

  const startServer = async () => {
    if (!server) {
      const port = getConfig<number>('amaze-browser.server.port', 8100)!
      const starting = new HttpServer(ctx.extensionPath, (view, url) => {
        manager.create(url, view).catch((e) => {
          view.dispose()
          window.showErrorMessage(`Amaze Browser: ${e instanceof Error ? e.message : e}`)
        })
      })
      try {
        await starting.listen(port)
      }
      catch (e) {
        starting.dispose()
        const reason = (e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `port ${port} is already in use` : String(e)
        window.showErrorMessage(`Amaze Browser: Cannot start the HTTP server, ${reason}. Change "amaze-browser.server.port" to use another one.`)
        return
      }
      server = starting
      // with VS Code Remote, this is the forwarded address on the user's machine
      serverUrl = await env.asExternalUri(Uri.parse(`http://localhost:${port}/`))
      starting.allowForwardedAddress(serverUrl.authority)
      serverStatus.text = `$(broadcast) Amaze :${port}`
      serverStatus.tooltip = `Amaze Browser is served at ${serverUrl.toString(true)}. Click to open it.`
      serverStatus.show()
    }

    const open = 'Open in Browser'
    const copy = 'Copy URL'
    const picked = await window.showInformationMessage(`Amaze Browser is served at ${serverUrl!.toString(true)}`, open, copy)
    if (picked === open)
      env.openExternal(serverUrl!)
    else if (picked === copy)
      env.clipboard.writeText(serverUrl!.toString(true))
  }

  const stopServer = () => {
    server?.dispose()
    server = undefined
    serverUrl = undefined
    serverStatus.hide()
  }

  // Download Chromium in the background on first activation (Linux only),
  // unless the user has configured their own executable
  if (!getConfig<string>('amaze-browser.chromeExecutable'))
    ensureChromium(ctx)

  ctx.subscriptions.push(

    debug.registerDebugConfigurationProvider(
      'amaze-browser',
      debugProvider.getProvider(),
    ),

    commands.registerCommand('amaze-browser.open', async (url?: string | Uri) => {
      try {
        return await manager.create(url)
      }
      catch (e) {
        console.error(e)
      }
    }),

    commands.registerCommand('amaze-browser.newTab', () => manager.create()),

    commands.registerCommand('amaze-browser.showHistory', () => manager.showHistory()),

    commands.registerCommand('amaze-browser.moveDevTools', () => manager.moveDevTools()),

    commands.registerCommand('amaze-browser.clearBrowsingData', () => manager.clearBrowsingData()),

    commands.registerCommand('amaze-browser.showSupportPrompt', () => manager.supportPrompt.show()),

    commands.registerCommand('amaze-browser.startServer', startServer),

    commands.registerCommand('amaze-browser.stopServer', stopServer),

    commands.registerCommand('amaze-browser.openServerInBrowser', () => {
      if (serverUrl)
        env.openExternal(serverUrl)
    }),

    serverStatus,

    { dispose: stopServer },

    commands.registerCommand('amaze-browser.openActiveFile', () => {
      const filename = window.activeTextEditor?.document?.fileName
      manager.createFile(filename)
    }),

    commands.registerCommand('amaze-browser.controls.refresh', () => {
      manager.current?.reload()
    }),

    commands.registerCommand('amaze-browser.controls.external', () => {
      manager.current?.openExternal(true)
    }),

    commands.registerCommand('amaze-browser.controls.debug', async () => {
      const panel = await manager.current?.createDebugPanel()
      panel?.show()
    }),

  )

  try {
    // https://code.visualstudio.com/updates/v1_53#_external-uri-opener
    // @ts-expect-error proposed API
    ctx.subscriptions.push(window.registerExternalUriOpener?.(
      'amaze-browser.opener',
      {
        // the server's own page belongs in the user's browser, not in a panel
        canOpenExternalUri: (uri: Uri) => serverUrl && uri.authority === serverUrl.authority ? 0 : 2,
        openExternalUri(resolveUri: Uri) {
          manager.create(resolveUri)
        },
      },
      {
        schemes: ['http', 'https'],
        label: 'Open URL using Amaze Browser',
      },
    ))
  }
  catch {}
}
