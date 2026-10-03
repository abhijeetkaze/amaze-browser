import type { EngineEndpoint } from './Engine'

export interface ExtensionConfiguration {
  chromeExecutable?: string
  extensionPath: string
  format: 'jpeg' | 'png'
  isVerboseMode: boolean
  engine: 'ts' | 'rust'
  // set when the webview should stream frames from the Rust engine
  engineEndpoint?: EngineEndpoint & { targetId: string }
  perfHud: boolean
  startUrl: string
  columnNumber: number
  quality: number
  everyNthFrame: number
  isDebug?: boolean
  debugHost: string
  debugPort: number
  storeUserData: boolean
  proxy: string
  otherArgs: string
}
