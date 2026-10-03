// Builds the Rust frame engine (engine/) into dist/bin/, where the extension looks for it.
// RUST_TARGET=<triple> cross-compiles, e.g. x86_64-apple-darwin on an arm64 Mac.
// Without cargo the build goes on without the engine (the extension then uses the TS one),
// except on CI, where a VSIX missing its engine must not ship.
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const target = process.env.RUST_TARGET
const exe = (target ? target.includes('windows') : process.platform === 'win32') ? 'amaze-engine.exe' : 'amaze-engine'

try {
  execFileSync('cargo', ['--version'], { stdio: 'ignore' })
}
catch {
  if (process.env.CI) {
    console.error('build-engine: cargo not found')
    process.exit(1)
  }
  console.warn('build-engine: cargo not found, building without the Rust engine')
  process.exit(0)
}

execFileSync('cargo', ['build', '--release', '--locked', ...(target ? ['--target', target] : [])], {
  cwd: join(root, 'engine'),
  stdio: 'inherit',
})

const built = join(root, 'engine', 'target', ...(target ? [target] : []), 'release', exe)
const outDir = join(root, 'dist', 'bin')
mkdirSync(outDir, { recursive: true })
copyFileSync(built, join(outDir, exe))
chmodSync(join(outDir, exe), 0o755)
console.log(`build-engine: ${join('dist', 'bin', exe)}`)
