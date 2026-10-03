// What was under the cursor when the page was right-clicked
export interface ContextMenuInfo {
  pageUrl: string
  linkUrl?: string
  srcUrl?: string
  mediaType?: string
  selectionText: string
  isEditable: boolean
}
