import type { InjectedUiCopy } from '@/ui/injected/contracts'
import { injectedSurfaceStyles } from '@/ui/styles/tokens/injected'

export class CandidateActionControls {
  readonly #copy: InjectedUiCopy
  readonly #announcedStates = new Set<'conflict' | 'failed' | 'pending'>()
  readonly #controls = new Map<
    Element,
    {
      button: HTMLButtonElement
      host: HTMLElement
      status: HTMLElement
      surface: HTMLElement
    }
  >()
  #announcer?: HTMLElement
  #announcerHost?: HTMLElement

  constructor(copy: InjectedUiCopy) {
    this.#copy = copy
  }

  mount(candidate: Element, onHide: () => void) {
    if (this.#controls.has(candidate)) {
      return
    }

    const host = document.createElement('div')
    host.dataset.contentlensActions = ''
    host.dataset.contentlensDecision = 'pending'
    const shadow = host.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = injectedSurfaceStyles

    const surface = document.createElement('div')
    surface.className = 'candidate-actions'
    surface.setAttribute('role', 'group')
    surface.setAttribute('aria-label', this.#copy.actionsLabel)
    surface.setAttribute('aria-busy', 'true')
    surface.setAttribute('aria-describedby', 'contentlens-decision-status')

    const status = document.createElement('p')
    status.className = 'decision-status'
    status.id = 'contentlens-decision-status'
    status.textContent = this.#copy.decisionPending

    const hide = document.createElement('button')
    hide.className = 'action'
    hide.dataset.contentlensHide = ''
    hide.type = 'button'
    hide.textContent = this.#copy.hideForSession
    hide.addEventListener('click', onHide)

    surface.append(status, hide)
    shadow.append(style, surface)
    candidate.insertAdjacentElement('afterend', host)
    this.#controls.set(candidate, { button: hide, host, status, surface })
    this.#announce('pending')
  }

  focus(candidate: Element) {
    const control = this.#controls.get(candidate)
    if (!control) {
      return false
    }
    control.button.focus()
    return true
  }

  focusedCandidate() {
    for (const [candidate, control] of this.#controls) {
      if (
        document.activeElement === control.host &&
        control.host.shadowRoot?.activeElement === control.button
      ) {
        return candidate
      }
    }
    return undefined
  }

  hasFocus(candidate: Element) {
    const control = this.#controls.get(candidate)
    return Boolean(
      control &&
        document.activeElement === control.host &&
        control.host.shadowRoot?.activeElement === control.button
    )
  }

  setDecisionState(
    candidate: Element,
    state: 'applied' | 'conflict' | 'deferred' | 'failed' | 'pending'
  ) {
    const control = this.#controls.get(candidate)
    if (!control) {
      return false
    }
    if (control.host.dataset.contentlensDecision === state) {
      return true
    }
    control.host.dataset.contentlensDecision = state
    control.surface.setAttribute(
      'aria-busy',
      state === 'pending' ? 'true' : 'false'
    )
    const hasStatus = !['applied', 'deferred'].includes(state)
    control.status.hidden = !hasStatus
    if (hasStatus) {
      control.surface.setAttribute(
        'aria-describedby',
        'contentlens-decision-status'
      )
    } else {
      control.surface.removeAttribute('aria-describedby')
    }
    control.status.textContent =
      state === 'pending'
        ? this.#copy.decisionPending
        : state === 'failed'
          ? this.#copy.decisionFailed
          : state === 'conflict'
            ? this.#copy.decisionConflict
            : ''
    if (state === 'pending' || state === 'failed' || state === 'conflict') {
      this.#announce(state)
    }
    return true
  }

  remove(candidate: Element) {
    const control = this.#controls.get(candidate)
    if (!control) {
      return false
    }
    control.host.remove()
    this.#controls.delete(candidate)
    return true
  }

  removeAll() {
    for (const candidate of [...this.#controls.keys()]) {
      this.remove(candidate)
    }
    this.#announcerHost?.remove()
    this.#announcer = undefined
    this.#announcerHost = undefined
    this.#announcedStates.clear()
  }

  count() {
    return this.#controls.size
  }

  #announce(state: 'conflict' | 'failed' | 'pending') {
    if (this.#announcedStates.has(state)) {
      return
    }
    this.#announcedStates.add(state)
    const announcer = this.#ensureAnnouncer()
    announcer.textContent =
      state === 'pending'
        ? this.#copy.decisionPending
        : state === 'failed'
          ? this.#copy.decisionFailed
          : this.#copy.decisionConflict
  }

  #ensureAnnouncer() {
    if (this.#announcer && this.#announcerHost?.isConnected) {
      return this.#announcer
    }

    const host = document.createElement('div')
    host.dataset.contentlensAnnouncer = ''
    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = injectedSurfaceStyles
    const announcer = document.createElement('p')
    announcer.className = 'decision-announcer'
    announcer.setAttribute('aria-atomic', 'true')
    announcer.setAttribute('aria-live', 'polite')
    announcer.setAttribute('role', 'status')
    shadow.append(style, announcer)
    document.body.append(host)
    this.#announcer = announcer
    this.#announcerHost = host
    return announcer
  }
}
