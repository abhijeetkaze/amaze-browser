import type { ExtensionContext } from 'vscode'
import { Uri, debug, env, window } from 'vscode'
import { getConfig } from './Config'

export const SUPPORT_URL = 'https://www.buymeacoffee.com/abhijeetkaze'

const STORAGE_KEY = 'amaze-browser.supportPrompt'
const DAY = 24 * 60 * 60 * 1000

// Only ask people who keep coming back, and rarely
const MIN_ACTIVE_DAYS = 5
const MIN_DAYS_INSTALLED = 7
const REMIND_AFTER_DAYS = 30
const MAX_PROMPTS = 2
// Let the page settle before showing anything
const PROMPT_DELAY = 5000

interface SupportPromptState {
  installedAt: number
  activeDays: string[]
  prompts: number
  lastPromptAt?: number
  done?: boolean
}

export function openSupportPage() {
  return env.openExternal(Uri.parse(SUPPORT_URL))
}

/**
 * Occasionally asks regular users to support the project. Shown as a regular
 * VS Code notification (never inside the page), at most twice, and never again
 * once the user supports or declines.
 */
export class SupportPrompt {
  private shownThisSession = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly ctx: ExtensionContext) {
    // synced, so people with several machines aren't asked on each of them
    ctx.globalState.setKeysForSync([STORAGE_KEY])
  }

  private get state(): SupportPromptState {
    return this.ctx.globalState.get<SupportPromptState>(STORAGE_KEY) ?? { installedAt: Date.now(), activeDays: [], prompts: 0 }
  }

  private save(state: SupportPromptState) {
    return this.ctx.globalState.update(STORAGE_KEY, state)
  }

  /** Called when a page finishes loading. */
  public async pageLoaded() {
    const state = this.state
    const today = new Date().toISOString().slice(0, 10)
    // the first save also records the install date
    if (!state.activeDays.includes(today)) {
      // only the count matters, so the list never needs to grow past the threshold
      state.activeDays = [...state.activeDays, today].slice(-MIN_ACTIVE_DAYS)
      await this.save(state)
    }

    if (this.shouldPrompt(state) && !this.timer)
      this.timer = setTimeout(() => this.prompt(), PROMPT_DELAY)
  }

  private shouldPrompt(state: SupportPromptState) {
    if (this.shownThisSession || state.done || state.prompts >= MAX_PROMPTS)
      return false
    if (!getConfig<boolean>('amaze-browser.showSupportPrompt', true))
      return false
    if (state.activeDays.length < MIN_ACTIVE_DAYS)
      return false
    if (Date.now() - state.installedAt < MIN_DAYS_INSTALLED * DAY)
      return false
    if (state.lastPromptAt && Date.now() - state.lastPromptAt < REMIND_AFTER_DAYS * DAY)
      return false
    return true
  }

  private async prompt() {
    this.timer = undefined
    const state = this.state
    // don't interrupt a debugging session; try again on a later page load
    if (!this.shouldPrompt(state) || debug.activeDebugSession)
      return

    this.shownThisSession = true
    await this.save({ ...state, prompts: state.prompts + 1, lastPromptAt: Date.now() })
    await this.show()
  }

  /** Shows the notification right away, without the usage checks. */
  public async show() {
    const support = 'Buy Me a Coffee'
    const later = 'Maybe Later'
    const never = 'Don\'t Ask Again'
    const answer = await window.showInformationMessage(
      'Enjoying Amaze Browser? It\'s free and open source. If it saves you time, consider buying me a coffee.',
      support,
      later,
      never,
    )

    if (answer === support)
      await openSupportPage()
    // closing the notification counts as "maybe later"
    if (answer === support || answer === never)
      await this.save({ ...this.state, done: true })
  }

  public dispose() {
    if (this.timer)
      clearTimeout(this.timer)
  }
}
