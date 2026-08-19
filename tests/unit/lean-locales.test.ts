import { describe, expect, it } from 'vitest'

import { renderLeanCatalog } from '../../scripts/build/lean-locales'

describe('packaged message catalogs', () => {
  it('drops translator descriptions and the pretty printing', () => {
    const lean = renderLeanCatalog({
      panelReady: {
        message: 'Ready',
        description: 'Panel status shown once the profile loads.'
      }
    })

    expect(lean).toBe('{"panelReady":{"message":"Ready"}}')
  })

  it('keeps the placeholders the browser needs to substitute', () => {
    const lean = renderLeanCatalog({
      reviewScoreLabel: {
        message: '$SCORE$ match',
        description: 'Relation score label.',
        placeholders: { score: { content: '$1' } }
      }
    })

    expect(JSON.parse(lean)).toEqual({
      reviewScoreLabel: {
        message: '$SCORE$ match',
        placeholders: { score: { content: '$1' } }
      }
    })
  })

  it('preserves every key and its text', () => {
    const catalog = {
      first: { message: 'Um', description: 'a' },
      second: { message: 'Dois', description: 'b' },
      third: { message: 'Três' }
    }

    expect(JSON.parse(renderLeanCatalog(catalog))).toEqual({
      first: { message: 'Um' },
      second: { message: 'Dois' },
      third: { message: 'Três' }
    })
  })

  it('rejects a catalog whose entry carries no text', () => {
    expect(() =>
      renderLeanCatalog({ broken: { description: 'no message' } })
    ).toThrow(/broken/u)
    expect(() => renderLeanCatalog(['panelReady'])).toThrow(TypeError)
  })
})
