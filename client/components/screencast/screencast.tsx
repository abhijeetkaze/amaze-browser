import React from 'react'
import './screencast.css'

// This implementation is heavily inspired by https://cs.chromium.org/chromium/src/third_party/blink/renderer/devtools/front_end/screencast/ScreencastView.js

export interface ScreencastFrame {
  data: ArrayBuffer | Uint8Array<ArrayBuffer>
  metadata: { timestamp?: number }
  droppedFrames: number
}

class Screencast extends React.Component<any, any> {
  private canvasRef: React.RefObject<HTMLCanvasElement>
  private hudRef: React.RefObject<HTMLDivElement>
  // decoded frame waiting for the next animation frame; a newer one replaces it
  private nextBitmap: ImageBitmap | null = null
  private nextTimestamp: number | undefined
  private drawRequest: number | null = null
  private hudTimer: number | undefined
  private stats = { drawn: 0, skipped: 0, latency: 0, hostDropped: 0, lastHostDropped: 0 }
  // latest pointer position, resolved at most once per animation frame
  private hoverPosition: { x: number, y: number } | null = null
  private hoverFrameId: number | null = null

  constructor(props: any) {
    super(props)
    this.canvasRef = React.createRef()
    this.hudRef = React.createRef()

    this.handleMouseEvent = this.handleMouseEvent.bind(this)
    this.handleKeyEvent = this.handleKeyEvent.bind(this)
    this.draw = this.draw.bind(this)
    this.updateHud = this.updateHud.bind(this)
    this.flushHover = this.flushHover.bind(this)
  }

  public componentDidMount() {
    this.hudTimer = window.setInterval(this.updateHud, 1000)
  }

  public componentWillUnmount() {
    window.clearInterval(this.hudTimer)
    if (this.hoverFrameId !== null)
      window.cancelAnimationFrame(this.hoverFrameId)
    if (this.drawRequest)
      window.cancelAnimationFrame(this.drawRequest)
    this.nextBitmap?.close()
  }

  // Frames bypass React state: decoding happens off the main thread and the canvas is
  // painted once per animation frame with the newest bitmap
  public async drawFrame(frame: ScreencastFrame, onDecoded: () => void) {
    let bitmap: ImageBitmap
    try {
      // the image type is sniffed from the bytes, so png and jpeg both work
      bitmap = await createImageBitmap(new Blob([frame.data]))
    }
    finally {
      onDecoded()
    }

    if (this.nextBitmap) {
      this.nextBitmap.close()
      this.stats.skipped++
    }
    this.nextBitmap = bitmap
    this.nextTimestamp = frame.metadata.timestamp
    this.stats.hostDropped = frame.droppedFrames
    if (!this.drawRequest)
      this.drawRequest = window.requestAnimationFrame(this.draw)
  }

  private draw() {
    this.drawRequest = null
    const bitmap = this.nextBitmap
    const canvas = this.canvasRef.current
    this.nextBitmap = null
    if (!bitmap)
      return
    if (canvas) {
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width
        canvas.height = bitmap.height
      }
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
      canvas.classList.add('has-frame')
      this.stats.drawn++
      if (this.nextTimestamp)
        this.stats.latency += Date.now() - this.nextTimestamp * 1000
    }
    bitmap.close()
  }

  private updateHud() {
    const hud = this.hudRef.current
    const { drawn, skipped, latency, hostDropped, lastHostDropped } = this.stats
    if (hud) {
      const heap = (performance as any).memory?.usedJSHeapSize
      hud.textContent = [
        `${drawn} fps`,
        `latency ${drawn ? Math.round(latency / drawn) : '-'} ms`,
        `dropped ${hostDropped - lastHostDropped + skipped}`,
        heap ? `heap ${Math.round(heap / 1048576)} MB` : '',
      ].filter(Boolean).join(' · ')
    }
    this.stats = { drawn: 0, skipped: 0, latency: 0, hostDropped, lastHostDropped: hostDropped }
  }

  public render() {
    const canvasStyle = {
      cursor: this.props.viewportMetadata?.cursor || 'auto',
      // only the CSS size: setting the width attribute would clear the canvas
      width: this.props.width,
    }

    return (
      <>
        <canvas
          className="screencast"
          ref={this.canvasRef}
          style={canvasStyle}
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
        {this.props.perfHud && <div className="screencast-hud" ref={this.hudRef} />}
      </>
    )
  }

  private handleContextMenu(event: React.MouseEvent<HTMLCanvasElement>) {
    event.preventDefault()
  }

  private handleMouseEvent(event: React.MouseEvent<HTMLCanvasElement>) {
    event.stopPropagation()
    if (this.props.isInspectEnabled) {
      if (event.type === 'click') {
        const position = this.convertIntoScreenSpace(event)
        this.props.onInspectElement({
          position,
        })
      }
    }
    else {
      this.dispatchMouseEvent(event.nativeEvent)
    }

    if (event.type === 'mousemove') {
      this.hoverPosition = this.convertIntoScreenSpace(event)
      if (this.hoverFrameId === null)
        this.hoverFrameId = window.requestAnimationFrame(this.flushHover)
    }

    if (event.type === 'mousedown') {
      if (this.canvasRef.current)
        this.canvasRef.current.focus()
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

  // webview pixels per CSS pixel of the page: the view's fit-to-window zoom times the page zoom
  private get pixelScale() {
    const { screenZoom, pageZoom = 1 } = this.props.viewportMetadata
    return screenZoom * pageZoom
  }

  private convertIntoScreenSpace(event: any) {
    const scale = this.pixelScale

    return {
      x: Math.round(event.nativeEvent.offsetX / scale),
      y: Math.round(event.nativeEvent.offsetY / scale),
    }
  }

  private handleKeyEvent(event: React.KeyboardEvent<HTMLCanvasElement>) {
    // Prevents events from penetrating into toolbar input
    event.stopPropagation()
    this.emitKeyEvent(event.nativeEvent)

    // Tab would move focus away, and Ctrl/Cmd+A would select the whole webview
    // instead of the page's content (the page handles select-all itself)
    if (event.key === 'Tab' || ((event.ctrlKey || event.metaKey) && event.code === 'KeyA'))
      event.preventDefault()

    if (this.canvasRef.current)
      this.canvasRef.current.focus()
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

    const scale = this.pixelScale

    const x = Math.round(event.offsetX / scale)
    const y = Math.round(event.offsetY / scale)

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
      params.deltaX = event.deltaX / scale
      params.deltaY = event.deltaY / scale
    }

    this.props.onInteraction('Input.dispatchMouseEvent', params)
  }
}

export default Screencast
