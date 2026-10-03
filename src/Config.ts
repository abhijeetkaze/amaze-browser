import { createServer } from 'http'
import type { ExtensionContext } from 'vscode'
import { workspace } from 'vscode'
import type { ExtensionConfiguration } from './ExtensionConfiguration'

export function getConfig<T>(key: string, v?: T) {
  return workspace.getConfiguration().get(key, v)
}

export function isDarkTheme() {
  const theme = getConfig('workbench.colorTheme', '').toLowerCase()

  // must be dark
  if (theme.match(/dark|black/i) != null)
    return true

  // must be light
  if (theme.match(/light/i) != null)
    return false

  // IDK, maybe dark
  return true
}

function isPortFree(port: number) {
  return new Promise((resolve) => {
    const server = createServer()
      .listen(port, () => {
        server.close()
        resolve(true)
      })
      .on('error', () => {
        resolve(false)
      })
  })
}
export function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function tryPort(start = 4000): Promise<number> {
  if (await isPortFree(start))
    return start
  return tryPort(start + 1)
}

export function getConfigs(ctx: ExtensionContext): ExtensionConfiguration {
  return {
    extensionPath: ctx.extensionPath,
    columnNumber: 2,
    isDebug: false,
    quality: getConfig('amaze-browser.quality', 80),
    everyNthFrame: getConfig('amaze-browser.everyNthFrame', 1),
    format: getConfig('amaze-browser.format', 'jpeg'),
    isVerboseMode: getConfig('amaze-browser.verbose', false),
    chromeExecutable: getConfig('amaze-browser.chromeExecutable'),
    startUrl: getConfig('amaze-browser.startUrl', 'https://github.com/abhijeetkaze/amaze-browser'),
    debugHost: getConfig('amaze-browser.debugHost', 'localhost'),
    debugPort: getConfig('amaze-browser.debugPort', 9222),
    storeUserData: getConfig('amaze-browser.storeUserData', true),
    proxy: getConfig('amaze-browser.proxy', ''),
    otherArgs: getConfig('amaze-browser.otherArgs', ''),
  }
}
