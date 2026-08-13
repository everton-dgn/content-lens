import type { InjectedUiCopy } from '@/ui/injected/contracts'
import { injectedSurfaceStyles } from '@/ui/styles/tokens/injected'

export type PlaceholderHandle = {
  host: HTMLElement
  reason: HTMLElement
  reveal: HTMLButtonElement
}

export function createInjectedPlaceholder(
  candidate: Element,
  pageInstanceId: string,
  reasonText: string,
  copy: InjectedUiCopy,
  onReveal: () => void
): PlaceholderHandle {
  const host = document.createElement('section')
  host.dataset.contentlensPlaceholder = pageInstanceId
  host.setAttribute('aria-label', copy.hiddenHeading)
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = injectedSurfaceStyles

  const surface = document.createElement('div')
  surface.className = 'surface'
  surface.setAttribute('role', 'status')
  surface.style.minBlockSize = `${Math.max(
    1,
    Math.ceil(candidate.getBoundingClientRect().height)
  )}px`

  const heading = document.createElement('p')
  heading.className = 'heading'
  heading.textContent = copy.hiddenHeading

  const reason = document.createElement('p')
  reason.className = 'reason'
  reason.dataset.contentlensReason = ''
  reason.textContent = reasonText

  const reveal = document.createElement('button')
  reveal.className = 'action'
  reveal.dataset.contentlensReveal = ''
  reveal.type = 'button'
  reveal.textContent = copy.reveal
  reveal.addEventListener('click', onReveal)

  surface.append(heading, reason, reveal)
  shadow.append(style, surface)

  return { host, reason, reveal }
}
