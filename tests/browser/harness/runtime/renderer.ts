export interface HideOptions {
  pageInstanceId: string
  reason: string
  onReveal?: () => void
}

export type HideResult = 'applied' | 'already-hidden'

interface AttributeSnapshot {
  ariaHidden: string | null
  hadAriaHidden: boolean
  hadHidden: boolean
  hadStyle: boolean
  style: string | null
}

interface HiddenCandidate {
  attributes: AttributeSnapshot
  pageInstanceId: string
  placeholder: HTMLElement
  reason: HTMLElement
}

const createPlaceholder = (
  candidate: Element,
  options: HideOptions
): {
  placeholder: HTMLElement
  reason: HTMLElement
} => {
  const placeholder = document.createElement('section')
  placeholder.dataset.contentlensPlaceholder = options.pageInstanceId
  placeholder.setAttribute('aria-label', 'Content hidden by ContentLens')
  placeholder.setAttribute('role', 'status')
  placeholder.style.boxSizing = 'border-box'
  placeholder.style.display = 'grid'
  placeholder.style.gap = '8px'
  placeholder.style.minBlockSize = `${Math.max(1, Math.ceil(candidate.getBoundingClientRect().height))}px`
  placeholder.style.padding = '12px'
  placeholder.style.border = '1px solid currentColor'
  placeholder.style.borderRadius = '8px'

  const heading = document.createElement('strong')
  heading.textContent = 'Content hidden'

  const reason = document.createElement('span')
  reason.dataset.contentlensReason = ''
  reason.textContent = `Reason: ${options.reason}`

  const reveal = document.createElement('button')
  reveal.dataset.contentlensReveal = ''
  reveal.type = 'button'
  reveal.textContent = 'Show'
  reveal.addEventListener('click', () => options.onReveal?.(), { once: true })

  placeholder.append(heading, reason, reveal)

  return { placeholder, reason }
}

export class ReversibleCandidateRenderer {
  readonly #hidden = new Map<Element, HiddenCandidate>()

  hide(candidate: Element, options: HideOptions): HideResult {
    const existing = this.#hidden.get(candidate)

    if (existing?.pageInstanceId === options.pageInstanceId) {
      existing.reason.textContent = `Reason: ${options.reason}`
      return 'already-hidden'
    }
    if (existing) {
      this.restore(candidate)
    }

    const attributes: AttributeSnapshot = {
      ariaHidden: candidate.getAttribute('aria-hidden'),
      hadAriaHidden: candidate.hasAttribute('aria-hidden'),
      hadHidden: candidate.hasAttribute('hidden'),
      hadStyle: candidate.hasAttribute('style'),
      style: candidate.getAttribute('style')
    }
    const { placeholder, reason } = createPlaceholder(candidate, options)

    candidate.setAttribute('aria-hidden', 'true')
    candidate.setAttribute('hidden', '')
    ;(candidate as HTMLElement).style.setProperty(
      'display',
      'none',
      'important'
    )
    candidate.insertAdjacentElement('afterend', placeholder)
    this.#hidden.set(candidate, {
      attributes,
      pageInstanceId: options.pageInstanceId,
      placeholder,
      reason
    })

    return 'applied'
  }

  restore(candidate: Element): boolean {
    const hidden = this.#hidden.get(candidate)

    if (!hidden) {
      return false
    }

    hidden.placeholder.remove()

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
    return true
  }

  restoreAll(): number {
    let restored = 0

    for (const candidate of [...this.#hidden.keys()]) {
      if (this.restore(candidate)) {
        restored += 1
      }
    }

    return restored
  }

  hiddenCount(): number {
    return this.#hidden.size
  }
}
