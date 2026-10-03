import { EventEmitter } from 'events'
import type { Memento } from 'vscode'
import type { HistoryEntry } from './HistoryEntry'

const STORAGE_KEY = 'amaze-browser.history'
export const MAX_HISTORY_ENTRIES = 10

// Pages that aren't worth remembering
const IGNORED_URL = /^(about:|data:|devtools:|chrome:|chrome-error:)/

/**
 * The most recently visited pages across all tabs, newest first.
 * Persisted in VS Code's global state so it survives restarts.
 */
export class History extends EventEmitter {
  constructor(private readonly storage: Memento) {
    super()
  }

  public list(): HistoryEntry[] {
    return this.storage.get<HistoryEntry[]>(STORAGE_KEY, [])
  }

  public async add(url: string, title?: string) {
    if (!url || IGNORED_URL.test(url))
      return

    const previous = this.list()
    const existing = previous.find(e => e.url === url)
    // keep a known title when the page reports none (e.g. right after navigation)
    const entry: HistoryEntry = { url, title: title && title !== url ? title : existing?.title || '', visitedAt: Date.now() }

    const isSame = previous[0]?.url === url && previous[0]?.title === entry.title
    const entries = [entry, ...previous.filter(e => e.url !== url)].slice(0, MAX_HISTORY_ENTRIES)
    await this.storage.update(STORAGE_KEY, entries)
    if (!isSame)
      this.emit('changed', entries)
  }

  public async clear() {
    await this.storage.update(STORAGE_KEY, [])
    this.emit('changed', [])
  }
}
