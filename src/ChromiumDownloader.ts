import { platform } from 'os'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  Browser,
  detectBrowserPlatform,
  getInstalledBrowsers,
  install,
  uninstall,
} from '@puppeteer/browsers'
import type { ExtensionContext } from 'vscode'
import { ProgressLocation, window } from 'vscode'

// Chromium snapshot revision to download. Pinned so every install gets the same build;
// bump it to upgrade (older downloaded builds are removed automatically).
// Pick a revision from https://commondatastorage.googleapis.com/chromium-browser-snapshots/index.html?prefix=Linux_x64/
export const CHROMIUM_BUILD_ID = '1710656'

let pending: Promise<string | undefined> | undefined

export function isChromiumDownloadSupported() {
  return platform() === 'linux'
}

function getCacheDir(ctx: ExtensionContext) {
  return join(ctx.globalStorageUri.fsPath, 'chromium')
}

async function findInstalledChromium(cacheDir: string) {
  const installed = await getInstalledBrowsers({ cacheDir })
  const match = installed.find(i => i.buildId === CHROMIUM_BUILD_ID && existsSync(i.executablePath))
  return match?.executablePath
}

async function removeOutdatedChromium(cacheDir: string) {
  const installed = await getInstalledBrowsers({ cacheDir })
  await Promise.all(
    installed
      .filter(i => i.buildId !== CHROMIUM_BUILD_ID)
      .map(i => uninstall({ browser: i.browser, buildId: i.buildId, platform: i.platform, cacheDir })
        .catch(e => console.error(e))),
  )
}

async function downloadChromium(cacheDir: string) {
  const browserPlatform = detectBrowserPlatform()
  if (!browserPlatform)
    throw new Error(`Unsupported platform: ${platform()}`)

  const buildId = CHROMIUM_BUILD_ID

  return await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: `Amaze Browser: Downloading Chromium (r${buildId})`,
    },
    async (progress) => {
      let reported = 0
      const installed = await install({
        browser: Browser.CHROMIUM,
        platform: browserPlatform,
        buildId,
        cacheDir,
        downloadProgressCallback(downloaded, total) {
          if (!total)
            return
          const percent = Math.floor((downloaded / total) * 100)
          if (percent > reported) {
            progress.report({ increment: percent - reported, message: `${percent}%` })
            reported = percent
          }
        },
      })
      return installed.executablePath
    },
  )
}

/**
 * Returns the path of the Chromium managed by Amaze Browser, downloading it on first use.
 * Only supported on Linux; resolves to undefined elsewhere or when the download fails.
 */
export function ensureChromium(ctx: ExtensionContext): Promise<string | undefined> {
  if (!isChromiumDownloadSupported())
    return Promise.resolve(undefined)

  if (!pending) {
    const cacheDir = getCacheDir(ctx)
    pending = (async () => {
      try {
        const path = await findInstalledChromium(cacheDir) || await downloadChromium(cacheDir)
        removeOutdatedChromium(cacheDir).catch(e => console.error(e))
        return path
      }
      catch (e) {
        console.error(e)
        window.showWarningMessage(`Amaze Browser: Failed to download Chromium: ${e instanceof Error ? e.message : e}`)
        // allow retrying on next launch
        pending = undefined
        return undefined
      }
    })()
  }

  return pending
}
