// A visited page, shared between the extension and the webview
export interface HistoryEntry {
  url: string
  title: string
  visitedAt: number
}
