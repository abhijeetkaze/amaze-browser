import { homedir } from 'os'
import { join, parse } from 'path'
import { existsSync } from 'fs'
import { mkdir, rename } from 'fs/promises'
import type { CDPSession } from 'puppeteer-core'
import type { Progress } from 'vscode'
import { ProgressLocation, Uri, commands, env, window } from 'vscode'
import { getConfig } from './Config'

interface ActiveDownload {
  name: string
  reported: number
  progress?: Progress<{ message?: string, increment?: number }>
  finish: () => void
}

export function getDownloadDir() {
  const configured = getConfig<string>('amaze-browser.downloadPath', '')?.trim()
  if (configured)
    return configured.replace(/^~(?=$|[/\\])/, homedir())
  return join(homedir(), 'Downloads')
}

// "report.pdf" -> "report (1).pdf" when the name is taken, like Chrome does
function uniquePath(dir: string, fileName: string) {
  const { name, ext } = parse(fileName)
  let candidate = join(dir, fileName)
  for (let i = 1; existsSync(candidate); i++)
    candidate = join(dir, `${name} (${i})${ext}`)
  return candidate
}

function formatBytes(bytes: number) {
  if (bytes < 1024)
    return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

/**
 * Saves files the page downloads into the download folder, with a progress
 * notification. Chromium writes each download under its GUID; once it completes
 * the file is renamed to the name the site suggested.
 */
export class Downloads {
  private active = new Map<string, ActiveDownload>()
  private dir = getDownloadDir()

  constructor(private readonly session: CDPSession) {}

  public async enable() {
    this.dir = getDownloadDir()
    await mkdir(this.dir, { recursive: true })
    await this.session.send('Browser.setDownloadBehavior', {
      behavior: 'allowAndName',
      downloadPath: this.dir,
      eventsEnabled: true,
    })
    this.session.on('Browser.downloadWillBegin', e => this.begin(e.guid, e.suggestedFilename))
    this.session.on('Browser.downloadProgress', e => this.progress(e.guid, e.state, e.receivedBytes, e.totalBytes))
  }

  private begin(guid: string, suggestedFilename: string) {
    const download: ActiveDownload = { name: suggestedFilename || 'download', reported: 0, finish: () => {} }
    this.active.set(guid, download)

    window.withProgress(
      { location: ProgressLocation.Notification, title: `Downloading ${download.name}`, cancellable: true },
      (progress, token) => new Promise<void>((resolve) => {
        download.progress = progress
        download.finish = resolve
        token.onCancellationRequested(() => {
          this.session.send('Browser.cancelDownload', { guid }).catch(() => {})
        })
      }),
    )
  }

  private async progress(guid: string, state: string, received: number, total: number) {
    const download = this.active.get(guid)
    if (!download)
      return

    if (state === 'inProgress') {
      if (total > 0) {
        const percent = Math.floor((received / total) * 100)
        download.progress?.report({ increment: percent - download.reported, message: `${formatBytes(received)} of ${formatBytes(total)}` })
        download.reported = percent
      }
      else {
        download.progress?.report({ message: formatBytes(received) })
      }
      return
    }

    this.active.delete(guid)
    download.finish()

    if (state === 'canceled')
      return

    try {
      const target = uniquePath(this.dir, download.name)
      await rename(join(this.dir, guid), target)
      const open = 'Open'
      const reveal = 'Show in Folder'
      const answer = await window.showInformationMessage(`Downloaded ${parse(target).base} to ${this.dir}`, open, reveal)
      if (answer === open)
        env.openExternal(Uri.file(target))
      else if (answer === reveal)
        commands.executeCommand('revealFileInOS', Uri.file(target))
    }
    catch (e) {
      window.showErrorMessage(`Amaze Browser: Failed to save ${download.name}: ${e instanceof Error ? e.message : e}`)
    }
  }
}
