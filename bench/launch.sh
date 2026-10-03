#!/usr/bin/env bash
# Opens one VS Code window per engine × format combination, each pointed at bench/index.html
# with the perf HUD on, to compare them side by side. Needs the extension installed
# (a platform VSIX, so the Rust engine is there). Run "Amaze Browser: Open..." in each window.
set -euo pipefail

bench=$(cd "$(dirname "$0")" && pwd)
port=9301

for engine in ts rust; do
  for format in jpeg png; do
    dir="$bench/.workspaces/$engine-$format"
    mkdir -p "$dir/.vscode"
    # separate debug ports and no shared profile: four Chromes can't share one user data dir
    cat > "$dir/.vscode/settings.json" <<EOF
{
  "window.title": "$engine · $format",
  "amaze-browser.engine": "$engine",
  "amaze-browser.format": "$format",
  "amaze-browser.perfHud": true,
  "amaze-browser.storeUserData": false,
  "amaze-browser.debugPort": $port,
  "amaze-browser.startUrl": "file://$bench/index.html",
  "amaze-browser.showSupportPrompt": false
}
EOF
    code --new-window "$dir"
    port=$((port + 1))
  done
done
