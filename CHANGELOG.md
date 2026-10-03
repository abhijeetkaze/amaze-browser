# Changelog

All notable changes to Amaze Browser are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-03

### Added

- Sponsor link in the marketplace listing and README, and a support item in the history menu
- An occasional notification asking regular users to support the project, at most twice and never again once they support or decline (turn off with `amaze-browser.showSupportPrompt`), and a **Show Support Notification** command
- Page zoom from the toolbar (zoom out, the current level, zoom in) and with <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>=</kbd>, <kbd>-</kbd> and <kbd>0</kbd>, in Chrome's steps from 25% to 500%; the page re-lays out like in a browser

### Changed

- Pages stream as JPEG at quality 80 instead of lossless PNG, for much smaller frames
- Smoother scrolling and animation with lower CPU use: frames are shown as soon as they are decoded instead of queueing up, and no longer re-render the whole browser UI
- Faster cursor updates when moving the mouse over the page
- Inspect mode no longer redraws the highlight on every frame, and the page is only tracked for inspecting while Inspect is on
- Navigation no longer waits on a user agent reset before every page load

### Fixed

- An emulated device's user agent is kept after navigating instead of being reset

## [1.0.1] - 2026-10-03

### Changed

- Removed the Preview label from the marketplace listing

## [1.0.0] - 2026-10-03

The first release of Amaze Browser, a fork of [Browse Lite](https://github.com/antfu/vscode-browse-lite) published as `abhijeetkaze.amaze-browser`.

### Added

- Embedded Chromium browser in an editor tab, with back, forward, reload, stop and an address bar
- Downloads and runs a pinned open-source Chromium build on Linux the first time it activates; uses the installed Chrome or Edge on macOS and Windows
- Tabs: a new tab button and **New Tab** command
- History of the 10 most recent pages, from a toolbar dropdown or the **Show History** command
- **Clear History and Cookies** command
- Downloads saved to `~/Downloads` (configurable with `amaze-browser.downloadPath`), with progress, **Open** and **Show in Folder**
- File uploads open VS Code's file picker, filtered by the page's accepted file types
- Find in page with <kbd>Ctrl</kbd>+<kbd>F</kbd> / <kbd>Cmd</kbd>+<kbd>F</kbd>: highlighted matches, a count and next/previous
- Chrome DevTools beside the page, placed right, bottom, left or in a separate window (`amaze-browser.devToolsPosition`), with a **Move DevTools...** command
- Right-click menu for links, images, text editing and viewing page source
- Device emulation, inspect element, live reload of local files and debugger attach
- Modern toolbar that follows the VS Code theme
- New Amaze Browser icon

### Changed

- Renamed commands, settings, the debugger type and context keys from `browse-lite.*` to `amaze-browser.*`

### Fixed

- Panels moved to another window reconnect instead of coming back blank
- No orange focus outline in inputs, broken-image icon before the first frame, or wrong viewport background

[1.1.0]: https://github.com/abhijeetkaze/amaze-browser/releases/tag/v1.1.0
[1.0.1]: https://github.com/abhijeetkaze/amaze-browser/releases/tag/v1.0.1
[1.0.0]: https://github.com/abhijeetkaze/amaze-browser/releases/tag/v1.0.0
