import type { ChildProcess } from 'child_process'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { createInterface } from 'readline'

// where the webview connects to stream frames from the Rust engine
export interface EngineEndpoint {
  port: number
  token: string
}

const STARTUP_TIMEOUT = 5000

function findBinary(extensionPath: string) {
  const exe = process.platform === 'win32' ? 'amaze-engine.exe' : 'amaze-engine'
  return [
    join(extensionPath, 'dist', 'bin', exe),
    // development build: cargo build --release in engine/
    join(extensionPath, 'engine', 'target', 'release', exe),
  ].find(p => existsSync(p))
}

/**
 * The Rust frame engine (engine/): owns a CDP connection per page and streams
 * binary frames to the webview, so frames skip the extension host entirely.
 */
export class Engine {
  private constructor(private process: ChildProcess, public readonly endpoint: EngineEndpoint) {}

  static start(extensionPath: string, cdpPort: number): Promise<Engine> {
    const binary = findBinary(extensionPath)
    if (!binary)
      return Promise.reject(new Error('amaze-engine binary not found'))

    // stdin stays open: the engine exits when it closes, i.e. when the extension host goes away
    const child = spawn(binary, ['--cdp-port', String(cdpPort)], { stdio: ['pipe', 'pipe', 'inherit'] })
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const fail = (err: Error) => {
        clearTimeout(timer)
        child.kill()
        reject(err)
      }
      timer = setTimeout(() => fail(new Error('amaze-engine did not start')), STARTUP_TIMEOUT)
      child.once('error', fail)
      child.once('exit', code => fail(new Error(`amaze-engine exited with code ${code}`)))
      createInterface({ input: child.stdout! }).once('line', (line) => {
        clearTimeout(timer)
        child.removeAllListeners('exit')
        try {
          resolve(new Engine(child, JSON.parse(line)))
        }
        catch (e) {
          fail(e instanceof Error ? e : new Error(String(e)))
        }
      })
    })
  }

  dispose() {
    this.process.kill()
  }
}
