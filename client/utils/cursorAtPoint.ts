// Resolves the CSS cursor under a point, run inside the page through Runtime.evaluate.
// One round trip, instead of locating the node through the DOM domain and asking CSS for its style.

/**
 * Must not reference anything outside itself: it is serialized with toString() and evaluated in the page.
 */
function cursorAt(x: number, y: number) {
  let doc: Document = document
  let element: Element | null = null
  for (;;) {
    let hit = doc.elementFromPoint(x, y)
    // descend into open shadow roots
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(x, y)
      if (!inner || inner === hit)
        break
      hit = inner
    }
    if (!hit)
      break
    element = hit
    if (hit.tagName !== 'IFRAME' && hit.tagName !== 'FRAME')
      break
    // same-origin frames only, cross-origin ones keep the frame element's cursor
    let inner: Document | null = null
    try {
      inner = (hit as HTMLIFrameElement).contentDocument
    }
    catch {}
    if (!inner)
      break
    const rect = hit.getBoundingClientRect()
    x -= rect.left + hit.clientLeft
    y -= rect.top + hit.clientTop
    doc = inner
  }
  return element ? getComputedStyle(element).cursor : 'auto'
}

export function cursorAtExpression(x: number, y: number) {
  return `(${cursorAt.toString()})(${x}, ${y})`
}
