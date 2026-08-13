import { describe, expect, it, vi } from 'vitest'

import { observeDomCandidates } from '@/adapters/shared/observe'

const flushMutations = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('DOM candidate observation', () => {
  it('tracks anonymous candidates, revisions, additions and removals', async () => {
    const root = document.createElement('main')
    document.body.append(root)
    const first = document.createElement('article')
    first.className = 'candidate'
    first.textContent = 'first'
    root.append(first)
    const candidates: Array<{
      domId: string
      pageInstanceId: string
      text: string
    }> = []
    const handle = observeDomCandidates(root, {
      candidateSelector: '.candidate',
      pageInstanceId: 'page:one',
      readSource: element => element.textContent ?? '',
      fingerprint: source => source,
      extract: (_element, pageInstanceId, domId, text) => ({
        domId,
        pageInstanceId,
        text
      }),
      onCandidate: candidate => candidates.push(candidate)
    })

    expect(candidates).toEqual([
      {
        domId: 'candidate-1',
        pageInstanceId: 'page:one:candidate-1',
        text: 'first'
      }
    ])
    handle.scan()
    expect(candidates).toHaveLength(1)
    expect(handle.isCurrent(first, 'page:one:candidate-1')).toBe(true)
    const applied = vi.fn()
    expect(handle.applyIfCurrent(first, 'stale', applied)).toBe(false)
    expect(handle.applyIfCurrent(first, 'page:one:candidate-1', applied)).toBe(
      true
    )
    expect(applied).toHaveBeenCalledOnce()

    first.textContent = 'changed'
    await flushMutations()
    expect(candidates.at(-1)).toEqual({
      domId: 'candidate-1',
      pageInstanceId: 'page:one:candidate-1:1',
      text: 'changed'
    })

    const wrapper = document.createElement('section')
    wrapper.innerHTML = '<article class="candidate" id="named">second</article>'
    root.append(wrapper)
    await flushMutations()
    expect(candidates.at(-1)).toEqual({
      domId: 'named',
      pageInstanceId: 'page:one:named',
      text: 'second'
    })
    const named = wrapper.querySelector('#named')
    if (!named) throw new Error('Named candidate is missing')
    wrapper.remove()
    await flushMutations()
    expect(handle.isCurrent(named, 'page:one:named')).toBe(false)

    handle.disconnect()
    root.remove()
  })

  it('isolates extraction and consumer failures', () => {
    const root = document.createElement('main')
    root.innerHTML = [
      '<article class="candidate">extract</article>',
      '<article class="candidate">consume</article>'
    ].join('')
    const errors = vi.fn()
    const handle = observeDomCandidates(root, {
      candidateSelector: '.candidate',
      pageInstanceId: 'page:errors',
      readSource: element => element.textContent ?? '',
      fingerprint: source => source,
      extract: (_element, _pageInstanceId, _domId, source) => {
        if (source === 'extract')
          throw new Error('synthetic extraction failure')
        return source
      },
      onCandidate: () => {
        throw new Error('synthetic consumer failure')
      },
      onError: errors
    })

    expect(errors).toHaveBeenNthCalledWith(1, 'candidate-extraction-failed')
    expect(errors).toHaveBeenNthCalledWith(2, 'candidate-consumer-failed')
    handle.disconnect()
  })
})
