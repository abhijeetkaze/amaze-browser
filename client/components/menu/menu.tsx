import React from 'react'
import './menu.css'

export interface MenuItem {
  label: string
  // secondary text on the right, e.g. a keyboard shortcut
  hint?: string
  // tooltip, e.g. the full URL of a truncated label
  title?: string
  disabled?: boolean
  action?: () => void
}

// null renders a separator
export type MenuEntry = MenuItem | null

export interface MenuPosition {
  x: number
  y: number
}

interface IProps {
  // where to open the menu, null when closed
  position: MenuPosition | null
  items: MenuEntry[]
  onClose: () => void
  // elements whose clicks shouldn't close the menu (e.g. the button that toggles it)
  ignoreClicksOn?: React.RefObject<HTMLElement>
}

interface IState {
  // position after keeping the menu inside the window
  fitted: MenuPosition | null
}

class Menu extends React.Component<IProps, IState> {
  private ref = React.createRef<HTMLUListElement>()

  constructor(props: IProps) {
    super(props)
    this.state = { fitted: null }
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
    if (prevProps.position !== this.props.position)
      this.fitIntoWindow()
  }

  private fitIntoWindow() {
    const position = this.props.position
    const el = this.ref.current
    if (!position || !el) {
      this.setState({ fitted: null })
      return
    }
    const { width, height } = el.getBoundingClientRect()
    let { x, y } = position
    if (x + width > window.innerWidth)
      x = Math.max(0, x - width)
    if (y + height > window.innerHeight)
      y = Math.max(0, window.innerHeight - height)
    this.setState({ fitted: { x, y } })
  }

  private handleOutsideMouseDown(e: MouseEvent) {
    const target = e.target as Node
    if (!this.props.position || this.ref.current?.contains(target) || this.props.ignoreClicksOn?.current?.contains(target))
      return
    this.props.onClose()
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (this.props.position && e.key === 'Escape') {
      e.stopPropagation()
      this.props.onClose()
    }
  }

  private handleClick(item: MenuItem) {
    if (item.disabled)
      return
    this.props.onClose()
    item.action?.()
  }

  public render() {
    const { position, items } = this.props
    if (!position)
      return null

    const { x, y } = this.state.fitted || position
    const style = {
      left: x,
      top: y,
      // hide until positioned to avoid flickering at the wrong spot
      visibility: this.state.fitted ? 'visible' : 'hidden',
    } as const

    return (
      <ul className="menu" role="menu" style={style} ref={this.ref} onContextMenu={e => e.preventDefault()}>
        {items.map((item, index) => item
          ? (
            <li
              key={index}
              role="menuitem"
              aria-disabled={item.disabled}
              title={item.title}
              className={`menu-item ${item.disabled ? 'disabled' : ''}`}
              onClick={() => this.handleClick(item)}
            >
              <span className="label">{item.label}</span>
              {item.hint && <span className="hint">{item.hint}</span>}
            </li>
            )
          : <li key={index} role="separator" className="menu-separator" />,
        )}
      </ul>
    )
  }
}

export default Menu
