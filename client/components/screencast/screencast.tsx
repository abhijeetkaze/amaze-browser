import React from 'react'
import './screencast.css'

// This implementation is heavily inspired by https://cs.chromium.org/chromium/src/third_party/blink/renderer/devtools/front_end/screencast/ScreencastView.js

class Screencast extends React.Component<any, any> {
  private imageRef: React.RefObject<HTMLImageElement>
  // latest pointer position, resolved at most once per animation frame
  private hoverPosition: { x: number, y: number } | null = null
  private hoverFrameId: number | null = null

  constructor(props: any) {
    super(props)
    this.imageRef = React.createRef()

    this.handleMouseEvent = this.handleMouseEvent.bind(this)
    this.handleKeyEvent = this.handleKeyEvent.bind(this)
    this.flushHover = this.flushHover.bind(this)

    this.state = {
      imageZoom: 1,
      screenOffsetTop: 0,
    }
  }

  public componentWillUnmount() {
    if (this.hoverFrameId !== null)
      window.cancelAnimationFrame(this.hoverFrameId)
  }

  /**
   * Shows a frame without re-rendering; resolves once it is decoded and ready to
   * paint, so the caller can ack it then and Chromium never runs ahead of the view.
   */
  public async paintFrame(base64Data: string, format: string) {
    const image = this.imageRef.current
    if (!image)
      return
    // the previous frame stays on screen until this one is decoded
    image.src = `data:image/${format};base64,${base64Data}`
    try {
      await image.decode()
    }
    catch {
      // superseded by a newer frame, or not decodable
    }
  }

  public render() {
    const canvasStyle = {
      cursor: this.props.viewportMetadata?.cursor || 'auto',
    }

    // src is set by paintFrame(); without one until the first frame, no broken-image icon shows
    return (
      <img
        className="screencast"
        alt=""
        ref={this.imageRef}
        style={canvasStyle}
        width={this.props.width}
        draggable="false"
        onMouseDown={this.handleMouseEvent}
        onMouseUp={this.handleMouseEvent}
        onMouseMove={this.handleMouseEvent}
        onClick={this.handleMouseEvent}
        onWheel={this.handleMouseEvent}
        onKeyDown={this.handleKeyEvent}
        onKeyUp={this.handleKeyEvent}
        onKeyPress={this.handleKeyEvent}
        onContextMenu={this.handleContextMenu}
        tabIndex={0}
      />
    )
  }

  private handleContextMenu(event: React.MouseEvent<HTMLImageElement>) {
    event.preventDefault()
  }

  private handleMouseEvent(event: React.MouseEvent<HTMLImageElement>) {
    event.stopPropagation()
    if (this.props.isInspectEnabled) {
      if (event.type === 'click') {
        const position = this.convertIntoScreenSpace(event, this.state)
        this.props.onInspectElement({
          position,
        })
      }
    }
    else {
      this.dispatchMouseEvent(event.nativeEvent)
    }

    if (event.type === 'mousemove') {
      this.hoverPosition = this.convertIntoScreenSpace(event, this.state)
      if (this.hoverFrameId === null)
        this.hoverFrameId = window.requestAnimationFrame(this.flushHover)
    }

    if (event.type === 'mousedown') {
      if (this.imageRef.current)
        this.imageRef.current.focus()
    }
  }

  // cursor and inspect-highlight lookups cost page round trips, so they run once per frame for the latest position
  private flushHover() {
    this.hoverFrameId = null
    const position = this.hoverPosition
    if (!position)
      return
    this.hoverPosition = null

    if (this.props.isInspectEnabled)
      this.props.onInspectHighlightRequested({ position })
    this.props.onMouseMoved({ position })
  }

  private convertIntoScreenSpace(event: any, state: any) {
    const { screenZoom } = this.props.viewportMetadata

    return {
      x: Math.round(event.nativeEvent.offsetX / screenZoom),
      y: Math.round(event.nativeEvent.offsetY / screenZoom),
    }
  }

  private handleKeyEvent(event: React.KeyboardEvent<HTMLImageElement>) {
    // Prevents events from penetrating into toolbar input
    event.stopPropagation()
    this.emitKeyEvent(event.nativeEvent)

    // Tab would move focus away, and Ctrl/Cmd+A would select the whole webview
    // instead of the page's content (the page handles select-all itself)
    if (event.key === 'Tab' || ((event.ctrlKey || event.metaKey) && event.code === 'KeyA'))
      event.preventDefault()

    if (this.imageRef.current)
      this.imageRef.current.focus()
  }

  private modifiersForEvent(event: any) {
    return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
  }

  private readonly isMac: boolean = /macintosh|mac os x/i.test(navigator.userAgent)

  private readonly clipboardMockMap = new Map([
    ['KeyC', 'document.dispatchEvent(new ClipboardEvent("copy"))'],
    ['KeyX', 'document.execCommand("cut")'], // 'document.dispatchEvent(new ClipboardEvent("cut"))',
    ['KeyV', 'document.dispatchEvent(new ClipboardEvent("paste"))'],
  ])

  private emitKeyEvent(event: any) {
    // HACK Simulate macos keyboard event.
    if (this.isMac && event.metaKey && this.clipboardMockMap.has(event.code)) {
      this.props.onInteraction('Runtime.evaluate', { expression: this.clipboardMockMap.get(event.code) })
      return
    }

    let type
    switch (event.type) {
      case 'keydown':
        type = 'keyDown'
        break
      case 'keyup':
        type = 'keyUp'
        break
      case 'keypress':
        type = 'char'
        break
      default:
        return
    }

    const text = event.type === 'keypress' ? String.fromCharCode(event.charCode) : undefined
    const params = {
      type,
      modifiers: this.modifiersForEvent(event),
      text,
      unmodifiedText: text ? text.toLowerCase() : undefined,
      keyIdentifier: event.keyIdentifier,
      code: event.code,
      key: event.key,
      windowsVirtualKeyCode: event.keyCode,
      nativeVirtualKeyCode: event.keyCode,
      autoRepeat: false,
      isKeypad: false,
      isSystemKey: false,
    }

    this.props.onInteraction('Input.dispatchKeyEvent', params)
  }

  private dispatchMouseEvent(event: any) {
    let clickCount = 0
    const buttons = { 0: 'none', 1: 'left', 2: 'middle', 3: 'right' }
    const types = {
      mousedown: 'mousePressed',
      mouseup: 'mouseReleased',
      mousemove: 'mouseMoved',
      wheel: 'mouseWheel',
    }

    if (!(event.type in types))
      return

    const { screenZoom } = this.props.viewportMetadata

    const x = Math.round(event.offsetX / screenZoom)
    const y = Math.round(event.offsetY / screenZoom)

    const type = (types as any)[event.type]

    if (type == 'mousePressed' || type == 'mouseReleased')
      clickCount = 1

    const params = {
      type,
      x,
      y,
      modifiers: this.modifiersForEvent(event),
      button: (buttons as any)[event.which],
      clickCount,
      deltaX: 0,
      deltaY: 0,
    }

    if (type === 'mouseWheel') {
      params.deltaX = event.deltaX / screenZoom
      params.deltaY = event.deltaY / screenZoom
    }

    this.props.onInteraction('Input.dispatchMouseEvent', params)
  }
}

export default Screencast
