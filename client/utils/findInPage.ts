// Find in page, run inside the page through Runtime.evaluate.
// Matches are painted with the CSS Custom Highlight API, so the page's DOM is never modified.

export interface FindResult {
  // 1-based index of the current match, 0 when there are none
  current: number
  total: number
}

/**
 * Installs the finder on the page's window. Must not reference anything outside
 * itself: it is serialized with toString() and evaluated in the page.
 */
function createFinder() {
  const MAX_MATCHES = 1000
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TEMPLATE'])
  let query = ''
  let ranges: Range[] = []
  let index = -1

  const sheet = new CSSStyleSheet()
  sheet.replaceSync(`
    ::highlight(amaze-find) { background-color: #fde047; color: #000; }
    ::highlight(amaze-find-current) { background-color: #fb923c; color: #000; }
  `)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]

  function collect(text: string) {
    const found: Range[] = []
    const needle = text.toLocaleLowerCase()
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (!parent || SKIP.has(parent.tagName) || !node.nodeValue?.trim())
          return NodeFilter.FILTER_REJECT
        return parent.checkVisibility?.() === false ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      },
    })
    for (let node = walker.nextNode(); node && found.length < MAX_MATCHES; node = walker.nextNode()) {
      const haystack = node.nodeValue!.toLocaleLowerCase()
      for (let at = haystack.indexOf(needle); at !== -1 && found.length < MAX_MATCHES; at = haystack.indexOf(needle, at + needle.length)) {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + needle.length)
        found.push(range)
      }
    }
    return found
  }

  function paint() {
    CSS.highlights.set('amaze-find', new Highlight(...ranges))
    if (index >= 0) {
      const current = ranges[index]
      CSS.highlights.set('amaze-find-current', new Highlight(current))
      const rect = current.getBoundingClientRect()
      if (rect.top < 0 || rect.bottom > innerHeight || rect.left < 0 || rect.right > innerWidth)
        current.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
    else {
      CSS.highlights.delete('amaze-find-current')
    }
  }

  return {
    // same text again moves to the next (or previous) match; new text starts over
    find(text: string, backwards: boolean) {
      if (!text) {
        this.clear()
        return { current: 0, total: 0 }
      }
      if (text !== query) {
        query = text
        ranges = collect(text)
        index = ranges.length ? 0 : -1
      }
      else if (ranges.length) {
        index = (index + (backwards ? -1 : 1) + ranges.length) % ranges.length
      }
      paint()
      return { current: index + 1, total: ranges.length }
    },
    clear() {
      query = ''
      ranges = []
      index = -1
      CSS.highlights.delete('amaze-find')
      CSS.highlights.delete('amaze-find-current')
    },
  }
}

const install = `(window.__amazeFind ||= (${createFinder.toString()})())`

export function findExpression(text: string, backwards: boolean) {
  return `${install}.find(${JSON.stringify(text)}, ${backwards})`
}

export function clearFindExpression() {
  return `window.__amazeFind?.clear()`
}
