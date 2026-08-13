import type { InjectedUiCopy } from '@/ui/injected/contracts'
import {
  createInjectedPlaceholder,
  type PlaceholderHandle
} from '@/ui/injected/placeholder'

export type HideCandidateOptions = {
  moveFocusToReveal?: boolean
  pageInstanceId: string
  reason: string
  onReveal: () => void
}

type AttributeSnapshot = {
  ariaHidden: string | null
  hadAriaHidden: boolean
  hadHidden: boolean
  hadStyle: boolean
  style: string | null
}

type HiddenCandidate = {
  attributes: AttributeSnapshot
  focusedElement: HTMLElement | null
  pageInstanceId: string
  placeholder: PlaceholderHandle
}

export class ReversibleCandidateRenderer {
  readonly #copy: InjectedUiCopy
  readonly #hidden = new Map<Element, HiddenCandidate>()

  constructor(copy: InjectedUiCopy) {
    this.#copy = copy
  }

  hide(candidate: Element, options: HideCandidateOptions) {
    const existing = this.#hidden.get(candidate)
    if (existing?.pageInstanceId === options.pageInstanceId) {
      existing.placeholder.reason.textContent = options.reason
      return 'already-hidden' as const
    }
    if (existing) {
      this.restore(candidate)
    }

    const focusedElement =
      document.activeElement instanceof HTMLElement &&
      candidate.contains(document.activeElement)
        ? document.activeElement
        : null
    const attributes: AttributeSnapshot = {
      ariaHidden: candidate.getAttribute('aria-hidden'),
      hadAriaHidden: candidate.hasAttribute('aria-hidden'),
      hadHidden: candidate.hasAttribute('hidden'),
      hadStyle: candidate.hasAttribute('style'),
      style: candidate.getAttribute('style')
    }
    const placeholder = createInjectedPlaceholder(
      candidate,
      options.pageInstanceId,
      options.reason,
      this.#copy,
      options.onReveal
    )

    candidate.setAttribute('aria-hidden', 'true')
    candidate.setAttribute('hidden', '')
    ;(candidate as HTMLElement).style.setProperty(
      'display',
      'none',
      'important'
    )
    candidate.insertAdjacentElement('afterend', placeholder.host)
    this.#hidden.set(candidate, {
      attributes,
      focusedElement,
      pageInstanceId: options.pageInstanceId,
      placeholder
    })
    if (focusedElement || options.moveFocusToReveal) {
      placeholder.reveal.focus()
    }
    return 'applied' as const
  }

  restore(candidate: Element) {
    const hidden = this.#hidden.get(candidate)
    if (!hidden) {
      return false
    }

    hidden.placeholder.host.remove()
    if (hidden.attributes.hadHidden) {
      candidate.setAttribute('hidden', '')
    } else {
      candidate.removeAttribute('hidden')
    }
    if (hidden.attributes.hadAriaHidden) {
      candidate.setAttribute('aria-hidden', hidden.attributes.ariaHidden ?? '')
    } else {
      candidate.removeAttribute('aria-hidden')
    }
    if (hidden.attributes.hadStyle) {
      candidate.setAttribute('style', hidden.attributes.style ?? '')
    } else {
      candidate.removeAttribute('style')
    }

    this.#hidden.delete(candidate)
    if (hidden.focusedElement?.isConnected) {
      hidden.focusedElement.focus()
      return 'restored-with-focus' as const
    }
    return 'restored' as const
  }

  restoreAll() {
    let restored = 0
    for (const candidate of [...this.#hidden.keys()]) {
      if (this.restore(candidate)) {
        restored += 1
      }
    }
    return restored
  }

  focusedCandidate() {
    for (const [candidate, hidden] of this.#hidden) {
      if (
        document.activeElement === hidden.placeholder.host &&
        hidden.placeholder.host.shadowRoot?.activeElement ===
          hidden.placeholder.reveal
      ) {
        return candidate
      }
    }
    return undefined
  }

  hiddenCount() {
    return this.#hidden.size
  }
}
