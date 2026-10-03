import React from 'react'
import type { ContextMenuInfo } from '../../../src/ContextMenuInfo'
import './page-contextmenu.css'

export interface PageContextMenuItem {
  label: string
  shortcut?: string
  disabled?: boolean
  action?: () => void
}

// null renders a separator
export type PageContextMenuEntry = PageContextMenuItem | null

export interface PageContextMenuState {
  info: ContextMenuInfo
  position: { x: number, y: number }
}

interface IProps {
  menu: PageContextMenuState | null
  items: PageContextMenuEntry[]
  onClose: () => void
}

interface IState {
  // position after keeping the menu inside the window
  position: { x: number, y: number } | null
}

class PageContextMenu extends React.Component<IProps, IState> {
  private ref = React.createRef<HTMLUListElement>()

  constructor(props: IProps) {
    super(props)
    this.state = { position: null }
    this.handleOutsideMouseDown = this.handleOutsideMouseDown.bind(this)
    this.handleKeyDown = this.handleKeyDown.bind(this)
  }

  componentDidMount() {
    document.addEventListener('mousedown', this.handleOutsideMouseDown, true)
    document.addEventListener('keydown', this.handleKeyDown, true)
    window.addEventListener('blur', this.props.onClose)
  }

  componentWillUnmount() {
    document.removeEventListener('mousedown', this.handleOutsideMouseDown, true)
    document.removeEventListener('keydown', this.handleKeyDown, true)
    window.removeEventListener('blur', this.props.onClose)
  }

  componentDidUpdate(prevProps: IProps) {
    if (prevProps.menu !== this.props.menu)
      this.fitIntoWindow()
  }

  private fitIntoWindow() {
    const menu = this.props.menu
    const el = this.ref.current
    if (!menu || !el) {
      this.setState({ position: null })
      return
    }
    const { width, height } = el.getBoundingClientRect()
    let { x, y } = menu.position
    if (x + width > window.innerWidth)
      x = Math.max(0, x - width)
    if (y + height > window.innerHeight)
      y = Math.max(0, window.innerHeight - height)
    this.setState({ position: { x, y } })
  }

  private handleOutsideMouseDown(e: MouseEvent) {
    if (this.props.menu && !this.ref.current?.contains(e.target as Node))
      this.props.onClose()
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (this.props.menu && e.key === 'Escape') {
      e.stopPropagation()
      this.props.onClose()
    }
  }

  private handleClick(item: PageContextMenuItem) {
    if (item.disabled)
      return
    this.props.onClose()
    item.action?.()
  }

  public render() {
    const { menu, items } = this.props
    if (!menu)
      return null

    const position = this.state.position || menu.position
    const style = {
      left: position.x,
      top: position.y,
      // hide until positioned to avoid flickering at the wrong spot
      visibility: this.state.position ? 'visible' : 'hidden',
    } as const

    return (
      <ul className="page-context-menu" style={style} ref={this.ref} onContextMenu={e => e.preventDefault()}>
        {items.map((item, index) => item
          ? (
            <li
              key={index}
              className={`page-context-menu-item ${item.disabled ? 'disabled' : ''}`}
              onClick={() => this.handleClick(item)}
            >
              <span className="label">{item.label}</span>
              {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
            </li>
            )
          : <li key={index} className="page-context-menu-separator" />,
        )}
      </ul>
    )
  }
}

export default PageContextMenu
