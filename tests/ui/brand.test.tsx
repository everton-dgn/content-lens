import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { brandIconPalette, createBrandIconSvg } from '@/ui/brand/mark'
import { Brand } from '@/ui/components/Brand'

describe('Brand', () => {
  it('renders the approved frame, decision and two converging signals', () => {
    document.body.innerHTML = renderToStaticMarkup(<Brand name="ContentLens" />)

    const mark = document.querySelector('.cl-brand__mark')

    expect(mark?.getAttribute('viewBox')).toBe('0 0 32 32')
    expect(mark?.querySelectorAll('.cl-brand__frame')).toHaveLength(1)
    expect(mark?.querySelectorAll('.cl-brand__decision')).toHaveLength(1)
    expect(mark?.querySelectorAll('.cl-brand__signal')).toHaveLength(4)
    expect(document.querySelector('.cl-brand__name')?.textContent).toBe(
      'ContentLens'
    )
  })

  it('derives the packaged icon from the same geometry', () => {
    const icon = createBrandIconSvg()

    expect(icon).toContain('viewBox="0 0 32 32"')
    expect(icon).toContain('aria-label="ContentLens"')
    expect(icon).toContain('stroke="#FFFFFF"')
    expect(brandIconPalette.signal).toBe('#FF7A80')
    expect(icon).toContain('fill="#FF7A80"')
    expect(icon).not.toContain('#9FBCFF')
    expect(icon.match(/<circle/g)).toHaveLength(2)
    expect(icon.match(/<rect/g)).toHaveLength(4)
  })
})
