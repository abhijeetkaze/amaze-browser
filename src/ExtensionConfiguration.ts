export interface ExtensionConfiguration {
  chromeExecutable?: string
  extensionPath: string
  format: 'jpeg' | 'png'
  isVerboseMode: boolean
  startUrl: string
  columnNumber: number
  quality: number
  everyNthFrame: number
  isDebug?: boolean
  // set for a browser tab served by the HTTP server, which opens DevTools in a tab of its own
  devToolsUrl?: string
  debugHost: string
  debugPort: number
  storeUserData: boolean
  proxy: string
  otherArgs: string
}
