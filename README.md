<p align="center">
<img src="resources/icon.png" alt="Amaze Browser" height="100"/>
</p>

<h1 align="center">
Amaze Browser
</h1>
<p align="center">
A fast, embedded Chromium browser right inside VS Code
</p>
<p align="center">
<a href="https://open-vsx.org/extension/abhijeetkaze/amaze-browser" target="__blank"><img src="https://img.shields.io/open-vsx/v/abhijeetkaze/amaze-browser?color=228cb3&label=Open%20VSX" alt="Open VSX Version" /></a>
</p>

- ⚡️ Fast page refreshing
- 🧭 Bundled Chromium on Linux, nothing else to install
- 🐞 Built-in DevTools
- 📱 Device emulation
- 🖱️ Right-click menu for links, images, text and the page
- 🌗 Dark mode and theme aware
- 🖥 Re-open in the system browser
- ✅ No telemetry

<p align="center">
<table><tr><td>Run <b><code>Amaze Browser: Open...</code></b> command to start the browser</tr></td></table>
</p>

<p align="center">
<img width="1192" alt="Preview 1" src="https://user-images.githubusercontent.com/11247099/109469316-d6192a80-7aa8-11eb-8a3b-d2d52bef34e4.png">
<img width="1192" alt="Preview 2" src="https://user-images.githubusercontent.com/11247099/109469308-d1547680-7aa8-11eb-9957-23a4d8ac35e6.png">
</p>

## Browser

Amaze Browser picks the browser in this order:

1. The executable set in `amaze-browser.chromeExecutable`
2. **Linux only:** a Chromium build that Amaze Browser downloads itself
3. A Chrome or Edge installation found on the system

### Bundled Chromium (Linux)

If `amaze-browser.chromeExecutable` is not set, Amaze Browser downloads an open-source [Chromium snapshot](https://commondatastorage.googleapis.com/chromium-browser-snapshots/index.html?prefix=Linux_x64/) (~150MB) the first time it activates and shows the progress in a notification. Later activations reuse it.

It is saved in the extension's global storage folder:

```
~/.config/Code/User/globalStorage/abhijeetkaze.amaze-browser/chromium/chromium/linux-<build>/chrome-linux/chrome
```

The first part of the path depends on how you run VS Code:

| Setup | Global storage folder |
| --- | --- |
| VS Code | `~/.config/Code/User/globalStorage/abhijeetkaze.amaze-browser/` |
| VS Code Insiders | `~/.config/Code - Insiders/User/globalStorage/abhijeetkaze.amaze-browser/` |
| VSCodium | `~/.config/VSCodium/User/globalStorage/abhijeetkaze.amaze-browser/` |
| Remote-SSH / WSL | `~/.vscode-server/data/User/globalStorage/abhijeetkaze.amaze-browser/` |

Things to know:

- The build is pinned by `CHROMIUM_BUILD_ID` in [`src/ChromiumDownloader.ts`](src/ChromiumDownloader.ts). When it changes, the new build is downloaded once and older builds are deleted.
- The download is kept across extension updates and removed by VS Code when the extension is uninstalled.
- Chromium needs the usual system libraries (for example `libnss3`, `libatk-bridge2.0-0`, `libgbm1`). If they are missing, install them or set `amaze-browser.chromeExecutable` to another browser.
- If the download fails, Amaze Browser shows a warning, falls back to a system browser and tries the download again on the next launch.

## Credits

Amaze Browser is a fork of [Browse Lite](https://github.com/antfu/vscode-browse-lite) by [Anthony Fu](https://github.com/antfu), which was itself forked from [Browser Preview](https://github.com/auchenberg/vscode-browser-preview) by [Kenneth Auchenberg](https://github.com/auchenberg). Thanks to both for the original work.

## License

MIT - Copyright (c) 2019 Kenneth Auchenberg

MIT - Copyright (c) 2021 Anthony Fu

MIT - Copyright (c) 2026 Abhijeet Mohanta
