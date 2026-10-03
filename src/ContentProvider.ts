import { join } from 'path'
import fs from 'fs'
import type { Webview } from 'vscode'
import { Uri } from 'vscode'
import type { ExtensionConfiguration } from './ExtensionConfiguration'

export class ContentProvider {
  constructor(private config: ExtensionConfiguration) { }

  getContent(webview: Webview) {
    const root = join(this.config.extensionPath, 'dist/client')
    const indexHTML = fs.readFileSync(join(root, 'index.html'), 'utf-8')

    return indexHTML.replace(
      /(src|href)="(.*?)"/g,
      // the build links assets relative to the page (./assets/...)
      (_, tag, url) => `${tag}="${webview.asWebviewUri(Uri.file(join(root, url.replace(/^\.?\//, ''))))}"`,
    )
  }
}
