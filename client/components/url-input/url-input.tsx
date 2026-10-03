import React from 'react'
import ContextMenu from '../contextmenu/contextmenu'
import type { IContextMenuProps } from '../contextmenu/contextmenu-models'
import { FileIcon, GlobeIcon, LockIcon, SearchIcon } from '../icons/icons'
import './url-input.css'

// Splits a URL for display: the host is emphasized and the scheme of web pages is hidden
function formatUrl(url: string) {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}${u.hash}`
      return { host: u.host, rest }
    }
  }
  catch {}
  return { host: '', rest: url }
}

function securityOf(url: string) {
  if (url.startsWith('https:'))
    return { Icon: LockIcon, label: 'Secure connection', kind: 'secure' }
  if (url.startsWith('http:'))
    return { Icon: GlobeIcon, label: 'Connection is not encrypted', kind: 'plain' }
  if (url.startsWith('file:'))
    return { Icon: FileIcon, label: 'Local file', kind: 'file' }
  return { Icon: SearchIcon, label: 'Address', kind: 'empty' }
}

interface IUrlInputState {
  isFocused: boolean
  hasChanged: boolean
  url: string
  urlSelectionStart: number | null
  urlSelectionEnd: number | null
  contextMenuProps: IContextMenuProps
}

class UrlInput extends React.Component<any, IUrlInputState> {
  private ref?: HTMLInputElement
  constructor(props: any) {
    super(props)
    this.state = {
      hasChanged: false,
      isFocused: false,
      url: this.props.url,
      urlSelectionStart: 0,
      urlSelectionEnd: 0,
      contextMenuProps: {
        menuItems: [],
        isVisible: false,
        position: { x: 0, y: 0 },
        setVisibility: this.setVisibility.bind(this),
        setUrl: this.setUrl.bind(this),
        enterUrl: this.enterUrl.bind(this),
        selectUrl: this.selectUrl.bind(this),
        onActionInvoked: this.props.onActionInvoked,
        selectedUrlInput: '',
      },
    }

    this.handleChange = this.handleChange.bind(this)
    this.handleFocus = this.handleFocus.bind(this)
    this.handleBlur = this.handleBlur.bind(this)
    this.handleKeyDown = this.handleKeyDown.bind(this)
    this.handleContextMenu = this.handleContextMenu.bind(this)

    this.setRef = this.setRef.bind(this)
  }

  UNSAFE_componentWillReceiveProps(nextProps: any) {
    if (nextProps.url !== this.state.url && !this.state.hasChanged) {
      this.setState({
        url: nextProps.url,
      })
    }
  }

  // changing ContextMenu visibility status from child components
  public setVisibility(value: boolean) {
    this.setState({
      contextMenuProps: {
        ...this.state.contextMenuProps,
        isVisible: value,
      },
    })
  }

  // changing url from child components
  public setUrl(value: string) {
    // if selectionStart and selectionEnd are available, then we have to
    // only modify that part of the url
    let newCursorPosition: number | null = null
    if (this.state.urlSelectionStart && this.state.urlSelectionEnd) {
      const _url: string = this.state.url
      const firstPart: string = _url.slice(0, this.state.urlSelectionStart)
      const secondPart: string = _url.slice(this.state.urlSelectionEnd)

      // set newCursorPosition
      newCursorPosition = (firstPart + value).length

      value = firstPart + value + secondPart
    }
    else if (this.state.urlSelectionStart) {
      const _url: string = this.state.url
      const firstPart: string = _url.slice(0, this.state.urlSelectionStart)
      const secondPart: string = _url.slice(this.state.urlSelectionStart)

      // set newCursorPosition
      newCursorPosition = (firstPart + value).length

      value = firstPart + value + secondPart
    }

    if (value !== this.state.url) {
      this.setState({
        url: value,
        hasChanged: true,
        isFocused: true,
      })

      // set urlCursorPosition
      if (this.ref && newCursorPosition) {
        this.ref.focus()
        this.ref.setSelectionRange(newCursorPosition, newCursorPosition)
      }
    }
  }

  public render() {
    const url = this.state.url === 'about:blank' ? '' : this.state.url
    const showFormatted = !this.state.isFocused && !this.state.hasChanged && !!url
    const { host, rest } = formatUrl(url)
    const security = securityOf(this.state.hasChanged ? '' : url)

    return (
      <div className={`omnibox ${this.state.isFocused ? 'focused' : ''}`}>
        <span className={`omnibox-security ${security.kind}`} title={security.label} aria-label={security.label} role="img">
          <security.Icon width={14} height={14} />
        </span>
        <input
          className={`urlbar ${showFormatted ? 'formatted' : ''}`}
          type="text"
          aria-label="Address"
          placeholder="Enter a URL"
          spellCheck={false}
          ref={this.setRef}
          value={url}
          onFocus={this.handleFocus}
          onBlur={this.handleBlur}
          onChange={this.handleChange}
          onKeyDown={this.handleKeyDown}
          onContextMenu={this.handleContextMenu}
        />
        {showFormatted && (
          <div className="omnibox-display" aria-hidden="true">
            <span className="host">{host}</span>
            <span className="rest">{rest}</span>
          </div>
        )}
        <ContextMenu {...this.state.contextMenuProps} />
      </div>
    )
  }

  private setRef(node: HTMLInputElement) {
    this.ref = node
  }

  private handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    this.setState({
      url: e.target.value,
      hasChanged: true,
    })
  }

  private handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    this.selectUrl(e.target)
  }

  // select all url from child components
  private selectUrl(element?: HTMLInputElement) {
    if (!element && this.ref)
      element = this.ref

    if (element) {
      element.select()
      this.setState({
        isFocused: true,
      })
    }
  }

  private handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    this.setState({
      isFocused: false,
    })
  }

  private handleContextMenu(e: React.MouseEvent<HTMLInputElement>) {
    e.preventDefault()
    this.setState({
      urlSelectionStart: (e.currentTarget as HTMLInputElement).selectionStart,
      urlSelectionEnd: (e.currentTarget as HTMLInputElement).selectionEnd,
      contextMenuProps: {
        ...this.state.contextMenuProps,
        isVisible: true,
        position: {
          x: e.clientX,
          y: e.clientY,
        },
        selectedUrlInput: this.state.isFocused
          ? window?.getSelection()?.toString() || ''
          : '',
      },
    })
  }

  private enterUrl() {
    let url = this.state.url.trimLeft()
    const schemeRegex = /^(https?|about|chrome|file):/

    if (!url.match(schemeRegex))
      url = `http://${this.state.url}`

    this.setState({
      hasChanged: false,
    })

    this.props.onUrlChanged(url)
  }

  private handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      this.enterUrl()
      this.ref?.blur()
    }
    else if (e.key === 'Escape') {
      this.setState({ url: this.props.url, hasChanged: false })
      this.ref?.blur()
    }
  }
}

export default UrlInput
