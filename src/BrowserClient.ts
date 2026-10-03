import { EventEmitter } from 'events'
import { platform } from 'os'
import { existsSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import edge from '@chiragrupani/karma-chromium-edge-launcher'
import chrome from 'karma-chrome-launcher'
import type { Browser } from 'puppeteer-core'
import puppeteer from 'puppeteer-core'
import type { ExtensionContext } from 'vscode'
import { window, workspace } from 'vscode'
import type { ExtensionConfiguration } from './ExtensionConfiguration'
import { tryPort } from './Config'
import { BrowserPage } from './BrowserPage'
import { ensureChromium } from './ChromiumDownloader'
import { Downloads } from './Downloads'

export function getUserDataDir(ctx: ExtensionContext) {
  return join(ctx.globalStorageUri.fsPath, 'UserData')
}

// Deletes the cookies of the saved profile; only safe while the browser isn't running
export async function clearSavedCookies(ctx: ExtensionContext) {
  // Chromium keeps cookies in Default/Network/Cookies (older versions: Default/Cookies)
  const files = ['Network/Cookies', 'Network/Cookies-journal', 'Cookies', 'Cookies-journal']
  await Promise.all(files.map(f => rm(join(getUserDataDir(ctx), 'Default', f), { force: true })))
}

export class BrowserClient extends EventEmitter {
  private browser: Browser

  constructor(private config: ExtensionConfiguration, private ctx: ExtensionContext) {
    super()
  }

  private async launchBrowser() {
    const chromeArgs = []

    this.config.debugPort = await tryPort(this.config.debugPort)

    chromeArgs.push(`--remote-debugging-port=${this.config.debugPort}`)

    chromeArgs.push('--allow-file-access-from-files')

    chromeArgs.push('--remote-allow-origins=*')

    // chromeArgs.push('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36')

    if (this.config.proxy && this.config.proxy.length > 0)
      chromeArgs.push(`--proxy-server=${this.config.proxy}`)

    if (this.config.otherArgs && this.config.otherArgs.length > 0)
      chromeArgs.push(this.config.otherArgs)

    const chromePath = this.config.chromeExecutable
      || await ensureChromium(this.ctx)
      || this.getChromiumPath()

    if (!chromePath) {
      window.showErrorMessage(
        'No Chrome installation found, or no Chrome executable set in the settings',
      )
      return
    }

    if (platform() === 'linux')
      chromeArgs.push('--no-sandbox')

    const extensionSettings = workspace.getConfiguration('amaze-browser')
    const ignoreHTTPSErrors = extensionSettings.get<boolean>('ignoreHttpsErrors')

    let userDataDir
    if (this.config.storeUserData)
      userDataDir = getUserDataDir(this.ctx)

    this.browser = await puppeteer.launch({
      executablePath: chromePath,
      args: chromeArgs,
      ignoreHTTPSErrors,
      ignoreDefaultArgs: ['--mute-audio'],
      userDataDir,
    })

    await new Downloads(await this.browser.target().createCDPSession()).enable()
      .catch(e => window.showWarningMessage(`Amaze Browser: Downloads are disabled: ${e instanceof Error ? e.message : e}`))

    // close the initial empty page
    ; (await this.browser.pages()).map(i => i.close())
  }

  public async newPage(): Promise<BrowserPage> {
    if (!this.browser)
      await this.launchBrowser()

    const page = new BrowserPage(this.browser, await this.createPageInNewWindow())
    await page.launch()
    return page
  }

  // Each page gets its own window: a page that shares a window with another one
  // becomes a background tab, which Chromium stops rendering, freezing its screencast
  private async createPageInNewWindow() {
    const session = await this.browser.target().createCDPSession()
    try {
      const { targetId } = await session.send('Target.createTarget', { url: 'about:blank', newWindow: true })
      // @ts-expect-error private API
      const target = await this.browser.waitForTarget(t => t._targetId === targetId)
      return await target.page()
    }
    finally {
      session.detach()
    }
  }

  /**
   * Deletes all cookies: through the running browser when there is one,
   * otherwise from the profile saved on disk.
   */
  public async clearCookies() {
    if (this.browser) {
      const session = await this.browser.target().createCDPSession()
      try {
        await session.send('Storage.clearCookies', {})
      }
      finally {
        await session.detach()
      }
      return
    }
    await clearSavedCookies(this.ctx)
  }

  public dispose(): Promise<void> {
    return new Promise((resolve) => {
      if (this.browser) {
        this.browser.close()
        this.browser = null
      }
      resolve()
    })
  }

  public getChromiumPath(): string | undefined {
    const knownChromiums = [...Object.entries(chrome), ...Object.entries(edge)]

    for (const [key, info] of knownChromiums) {
      if (!key.startsWith('launcher'))
        continue

      const path = info?.[1]?.prototype?.DEFAULT_CMD?.[process.platform]
      if (path && typeof path === 'string' && existsSync(path))
        return path
    }

    return undefined
  }
}
