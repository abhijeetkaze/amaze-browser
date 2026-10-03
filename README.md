<p align="center">
<img src="https://antfu.gallerycdn.vsassets.io/extensions/antfu/browse-lite/0.0.11/1614585407925/Microsoft.VisualStudio.Services.Icons.Default" alt="Logo" height="100"/>
</p>

<h1 align="center">
Browse Lite
</h1>
<p align="center">
Embedded browser in VS Code
</p>
<p align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=antfu.browse-lite" target="__blank"><img src="https://img.shields.io/visual-studio-marketplace/v/antfu.browse-lite.svg?color=228cb3&amp;label=" alt="Visual Studio Marketplace Version" /></a>
</h1>

> Forked from [Browser Preview](https://github.com/auchenberg/vscode-browser-preview) by [Kenneth Auchenberg](https://github.com/auchenberg)

- ⚡️ Faster page refreshing
- 🌗 Dark mode aware
- 🎨 Theme-aware UI
- 🐞 Built-in devtools support
- 🔌 Extendable actions
- 🖥 Re-open in the system browser
- ✅ No Telemetry
- 🍃 Much lighter [`10.3MB` ➡️ `212KB`](https://user-images.githubusercontent.com/11247099/109819001-90a65a00-7c6e-11eb-8d82-465ec8b22eba.png)

<p align="center">
<table><tr><td>Run <b><code>Browse Lite: Open...</code></b> command to start the browser</tr></td></table>
</p>

<p align="center">
<img width="1192" alt="Preview 1" src="https://user-images.githubusercontent.com/11247099/109469316-d6192a80-7aa8-11eb-8a3b-d2d52bef34e4.png">
<img width="1192" alt="Preview 2" src="https://user-images.githubusercontent.com/11247099/109469308-d1547680-7aa8-11eb-9957-23a4d8ac35e6.png">
</p>

This extension was originally built for [VS Code for Vite](https://github.com/antfu/vscode-vite).

## Browser

Browse Lite picks the browser in this order:

1. The executable set in `browse-lite.chromeExecutable`
2. **Linux only:** a Chromium build that Browse Lite downloads itself
3. A Chrome or Edge installation found on the system

### Bundled Chromium (Linux)

If `browse-lite.chromeExecutable` is not set, Browse Lite downloads an open-source [Chromium snapshot](https://commondatastorage.googleapis.com/chromium-browser-snapshots/index.html?prefix=Linux_x64/) (~150MB) the first time it activates and shows the progress in a notification. Later activations reuse it.

It is saved in the extension's global storage folder:

```
~/.config/Code/User/globalStorage/antfu.browse-lite/chromium/chromium/linux-<build>/chrome-linux/chrome
```

The first part of the path depends on how you run VS Code:

| Setup | Global storage folder |
| --- | --- |
| VS Code | `~/.config/Code/User/globalStorage/antfu.browse-lite/` |
| VS Code Insiders | `~/.config/Code - Insiders/User/globalStorage/antfu.browse-lite/` |
| VSCodium | `~/.config/VSCodium/User/globalStorage/antfu.browse-lite/` |
| Remote-SSH / WSL | `~/.vscode-server/data/User/globalStorage/antfu.browse-lite/` |

Things to know:

- The build is pinned by `CHROMIUM_BUILD_ID` in [`src/ChromiumDownloader.ts`](src/ChromiumDownloader.ts). When it changes, the new build is downloaded once and older builds are deleted.
- The download is kept across extension updates and removed by VS Code when the extension is uninstalled.
- Chromium needs the usual system libraries (for example `libnss3`, `libatk-bridge2.0-0`, `libgbm1`). If they are missing, install them or set `browse-lite.chromeExecutable` to another browser.
- If the download fails, Browse Lite shows a warning, falls back to a system browser and tries the download again on the next launch.

## Sponsors

This project is part of my [Sponsor Program](https://github.com/sponsors/antfu).

<p align="center">
  <a href="https://cdn.jsdelivr.net/gh/antfu/static/sponsors.svg">
    <img src='https://cdn.jsdelivr.net/gh/antfu/static/sponsors.png'/>
  </a>
</p>

## License

MIT - Copyright (c) 2019 Kenneth Auchenberg

MIT - Copyright (c) 2021 Anthony Fu
