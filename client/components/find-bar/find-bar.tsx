import React from 'react'
import type { FindResult } from '../../utils/findInPage'
import { ChevronDownIcon, ChevronUpIcon, StopIcon } from '../icons/icons'
import './find-bar.css'

interface IProps {
  result: FindResult | null
  onFind: (text: string, backwards: boolean) => void
  onClose: () => void
}

interface IState {
  text: string
}

class FindBar extends React.Component<IProps, IState> {
  private inputRef = React.createRef<HTMLInputElement>()

  constructor(props: IProps) {
    super(props)
    this.state = { text: '' }
    this.handleChange = this.handleChange.bind(this)
    this.handleKeyDown = this.handleKeyDown.bind(this)
  }

  componentDidMount() {
    this.focus()
  }

  // called again when Ctrl+F is pressed while the bar is already open
  public focus() {
    this.inputRef.current?.focus()
    this.inputRef.current?.select()
  }

  private handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const text = e.target.value
    this.setState({ text })
    this.props.onFind(text, false)
  }

  private handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      this.props.onFind(this.state.text, e.shiftKey)
    }
    else if (e.key === 'Escape') {
      e.preventDefault()
      this.props.onClose()
    }
  }

  public render() {
    const { result } = this.props
    const hasText = this.state.text.length > 0
    const noMatches = hasText && result?.total === 0

    return (
      <div className="find-bar" role="search">
        <input
          ref={this.inputRef}
          className={`find-input ${noMatches ? 'no-matches' : ''}`}
          type="text"
          placeholder="Find in page"
          aria-label="Find in page"
          spellCheck={false}
          value={this.state.text}
          onChange={this.handleChange}
          onKeyDown={this.handleKeyDown}
        />
        <span className={`find-count ${noMatches ? 'no-matches' : ''}`} aria-live="polite">
          {hasText && result ? `${result.current}/${result.total}` : ''}
        </span>
        <span className="find-divider" aria-hidden="true" />
        <button
          className="toolbar-button"
          title="Previous match (Shift+Enter)"
          aria-label="Previous match"
          disabled={!result?.total}
          onClick={() => this.props.onFind(this.state.text, true)}
        >
          <ChevronUpIcon />
        </button>
        <button
          className="toolbar-button"
          title="Next match (Enter)"
          aria-label="Next match"
          disabled={!result?.total}
          onClick={() => this.props.onFind(this.state.text, false)}
        >
          <ChevronDownIcon />
        </button>
        <button
          className="toolbar-button"
          title="Close (Escape)"
          aria-label="Close find bar"
          onClick={this.props.onClose}
        >
          <StopIcon />
        </button>
      </div>
    )
  }
}

export default FindBar
