import type { ExtensionContext, Uri } from 'vscode'
import { commands, debug, window } from 'vscode'

import { DebugProvider } from './DebugProvider'
import { ensureChromium } from './ChromiumDownloader'
import { getConfig } from './Config'
import { PanelManager } from './PanelManager'

export function activate(ctx: ExtensionContext) {
  const manager = new PanelManager(ctx)
  const debugProvider = new DebugProvider(manager)

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

    commands.registerCommand('amaze-browser.clearBrowsingData', () => manager.clearBrowsingData()),

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
        canOpenExternalUri: () => 2,
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
