import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  PortableImportExportService,
  PortableImportPreview
} from '@/application/import-export/service'
import { createLocalProfile } from '@/application/profile/local-profile'
import type { Rule } from '@/core/rules/contracts/rule'
import type { ProfileEnvelope } from '@/storage/contracts/profile-envelope'
import type { DataPanelCopy } from '@/ui/data/copy'
import { DataPanel } from '@/ui/data/DataPanel'
import type { DataMutationOutcome } from '@/ui/data/useDataTools'
import type { RuleWorkbenchCopy } from '@/ui/rules/copy'
import {
  RuleWorkbench,
  type RuleWorkbenchProps
} from '@/ui/rules/RuleWorkbench'

const hookMocks = vi.hoisted(() => ({
  useDataTools: vi.fn()
}))

vi.mock('@/ui/data/useDataTools', async importOriginal => {
  const original =
    await importOriginal<typeof import('@/ui/data/useDataTools')>()
  return {
    ...original,
    useDataTools: hookMocks.useDataTools
  }
})

const at = '2026-07-30T03:00:00.000Z'
const copyFromKeys = <Copy extends object>(prefix: string) =>
  new Proxy(
    {},
    {
      get: (_target, key) => {
        const name = String(key)
        return `${prefix}${name.slice(0, 1).toUpperCase()}${name.slice(1)}`
      }
    }
  ) as Copy

const dataCopy = copyFromKeys<DataPanelCopy>('data')
const ruleCopy = copyFromKeys<RuleWorkbenchCopy>('rules')

type MountedView = {
  container: HTMLDivElement
  render: (element: ReactElement) => Promise<void>
  root: Root
}

const mounted: MountedView[] = []

async function mount(element: ReactElement): Promise<MountedView> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const view = {
    container,
    root,
    render: async (next: ReactElement) => {
      await act(async () => {
        root.render(next)
      })
    }
  }
  mounted.push(view)
  await view.render(element)
  return view
}

function button(container: HTMLElement, label: string) {
  const match = [...container.querySelectorAll('button')].find(
    candidate => candidate.textContent === label
  )
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }
  return match
}

function radio(container: HTMLElement, label: string) {
  const match = [...container.querySelectorAll('[role="radio"]')].find(
    candidate => candidate.textContent?.includes(label)
  )
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Radio not found: ${label}`)
  }
  return match
}

function expectOnePrimaryAction(container: HTMLElement) {
  const primaries = container.querySelectorAll('[data-variant="primary"]')
  expect(primaries).toHaveLength(1)
}

async function click(target: HTMLButtonElement | HTMLInputElement) {
  await act(async () => {
    target.click()
    await Promise.resolve()
  })
}

async function changeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function changeTextarea(input: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
}

const exactRule = (
  id = 'rule:exact:one'
): Extract<Rule, { kind: 'exact' }> => ({
  id,
  enabled: true,
  scope: {
    platforms: ['youtube'],
    surfaces: ['youtube:home', 'youtube:search', 'youtube:recommendations']
  },
  createdAt: at,
  updatedAt: at,
  kind: 'exact',
  effect: 'block',
  field: 'title',
  value: 'transfer gossip',
  caseSensitive: false
})

const profileWith = (rules: Rule[]): ProfileEnvelope => ({
  ...createLocalProfile({ at, profileId: 'profile:panel-interactions' }),
  rules
})

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean
    }
  ).IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:contentlens-test')
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn()
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(async () => {
  while (mounted.length > 0) {
    const view = mounted.pop()
    if (view) {
      await act(async () => {
        view.root.unmount()
      })
      view.container.remove()
    }
  }
  vi.restoreAllMocks()
})

describe('data panel interactions', () => {
  const readyTools = () => ({
    applyPortableMerge: vi.fn<() => Promise<DataMutationOutcome>>(
      async () => 'committed'
    ),
    applyPortableReplace: vi.fn<() => Promise<DataMutationOutcome>>(
      async () => 'committed'
    ),
    applyImport: vi.fn<() => Promise<DataMutationOutcome>>(
      async () => 'committed'
    ),
    clearDiagnostics: vi.fn(async () => true),
    exportDiagnostics: vi.fn(async () => ({ events: [] })),
    exportPortableEncrypted: vi.fn(async () => 'encrypted'),
    exportPortablePlaintext: vi.fn(async () => 'plaintext'),
    exportProfile: vi.fn(async () =>
      profileWith([exactRule('rule:exact:export')])
    ),
    load: vi.fn(async () => undefined),
    pending: false,
    previewImport: vi.fn(async (raw: string) => ({
      ok: true,
      raw,
      summary: {
        currentRevision: 0,
        feedbackExamples: 1,
        incomingRevision: 1,
        profileIdChanges: false,
        rules: 1
      }
    })),
    previewPortableImport: vi.fn<
      (
        ...args: Parameters<PortableImportExportService['preview']>
      ) => Promise<Awaited<ReturnType<PortableImportExportService['preview']>>>
    >(async () => ({
      state: 'preview' as const,
      preview: {
        currentRevision: 0,
        encrypted: false,
        envelope: {} as never,
        changes: {
          categories: {} as never,
          totals: { added: 1, changed: 2, removed: 3, unchanged: 4 },
          tombstones: 0
        },
        merge: {
          state: 'unavailable' as const,
          code: 'profile-mismatch' as const
        }
      } satisfies PortableImportPreview
    })),
    reset: vi.fn<() => Promise<DataMutationOutcome>>(async () => 'committed'),
    resolvePortableConflicts: vi.fn<
      (
        ...args: Parameters<PortableImportExportService['resolve']>
      ) => Promise<Awaited<ReturnType<PortableImportExportService['resolve']>>>
    >(async () => ({
      state: 'resolution-unavailable' as const
    })),
    restore: vi.fn<() => Promise<DataMutationOutcome>>(async () => 'committed'),
    restoreImportSnapshot: vi.fn<() => Promise<DataMutationOutcome>>(
      async () => 'committed'
    ),
    restorePortableImportSnapshot: vi.fn<() => Promise<DataMutationOutcome>>(
      async () => 'committed'
    ),
    state: {
      status: 'ready' as const,
      diagnostics: [{ count: 2 }],
      importSnapshotAvailable: true,
      portableImportSnapshotAvailable: false,
      recovery: {
        state: 'recoverable' as const,
        primaryAction: 'restore' as const,
        actions: ['restore'] as const,
        preserved: ['profile'] as const
      }
    }
  })

  const panel = (
    onBack = vi.fn(),
    onProfileChanged = vi.fn(async () => undefined)
  ) => (
    <DataPanel
      copy={dataCopy}
      database={{} as never}
      diagnostics={{} as never}
      onBack={onBack}
      onProfileChanged={onProfileChanged}
    />
  )

  it('renders loading and error states and retries the load', async () => {
    const tools = readyTools()
    tools.state = { status: 'loading' } as never
    hookMocks.useDataTools.mockReturnValue(tools)
    const view = await mount(panel())

    expect(view.container.textContent).toContain('dataPending')

    tools.state = { status: 'error' } as never
    await view.render(panel())
    await click(button(view.container, 'dataRetryAction'))

    expect(tools.load).toHaveBeenCalledOnce()
  })

  it('reviews, cancels and completes diagnostic and recovery actions', async () => {
    const tools = readyTools()
    tools.restore
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('committed')
    tools.restoreImportSnapshot
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('committed')
    const onBack = vi.fn()
    hookMocks.useDataTools.mockReturnValue(tools)
    const view = await mount(panel(onBack))

    expectOnePrimaryAction(view.container)
    expect(view.container.textContent).toContain('dataDiagnosticsCountLabel')
    expect(view.container.textContent).toContain('dataRecoveryRecoverable')
    await click(button(view.container, 'dataBackAction'))
    expect(onBack).toHaveBeenCalledOnce()

    await click(button(view.container, 'dataReviewDiagnosticsExportAction'))
    expect(view.container.textContent).toContain(
      'dataDiagnosticsExportReviewTitle'
    )
    await click(button(view.container, 'dataCancelAction'))
    await click(button(view.container, 'dataReviewDiagnosticsExportAction'))
    await click(button(view.container, 'dataConfirmDiagnosticsExportAction'))
    expect(tools.exportDiagnostics).toHaveBeenCalledOnce()

    await click(button(view.container, 'dataClearDiagnosticsAction'))
    await click(button(view.container, 'dataCancelAction'))
    await click(button(view.container, 'dataClearDiagnosticsAction'))
    await click(button(view.container, 'dataConfirmClearDiagnosticsAction'))
    expect(tools.clearDiagnostics).toHaveBeenCalledOnce()

    await click(button(view.container, 'dataRestoreAction'))
    expect(view.container.textContent).toContain('dataPendingTitle')
    await click(button(view.container, 'dataPendingAction'))
    expect(tools.restore).toHaveBeenCalledTimes(2)
    await click(button(view.container, 'dataRestoreImportAction'))
    expect(view.container.textContent).toContain('dataPendingTitle')
    await click(button(view.container, 'dataPendingAction'))
    expect(tools.restoreImportSnapshot).toHaveBeenCalledTimes(2)

    await click(button(view.container, 'dataReviewResetAction'))
    await click(button(view.container, 'dataCancelAction'))
    await click(button(view.container, 'dataReviewResetAction'))
    await click(button(view.container, 'dataConfirmResetAction'))
    expect(tools.reset).toHaveBeenCalledOnce()
  })

  it('previews and applies a selected profile, then reports an invalid file', async () => {
    const tools = readyTools()
    tools.applyPortableReplace
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('committed')
    hookMocks.useDataTools.mockReturnValue(tools)
    const view = await mount(panel())
    const input = view.container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('File input not found.')
    }
    const valid = new File(['portable profile'], 'profile.json', {
      type: 'application/json'
    })
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [valid]
    })

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(view.container.textContent).toContain('dataImportPreviewTitle')
    await click(button(view.container, 'dataImportReplaceReviewAction'))
    await click(button(view.container, 'dataApplyImportAction'))
    expect(view.container.textContent).toContain('dataPendingTitle')
    await click(button(view.container, 'dataPendingAction'))
    expect(tools.applyPortableReplace).toHaveBeenCalledTimes(2)
    expect(view.container.textContent).toContain('dataImportSuccessTitle')

    tools.previewPortableImport.mockResolvedValueOnce({
      state: 'invalid',
      code: 'portability-file-invalid'
    })
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['invalid'], 'invalid.json')]
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(view.container.textContent).toContain('dataImportInvalidTitle')
  })

  it('unlocks an encrypted portable profile before showing its preview', async () => {
    const tools = readyTools()
    tools.previewPortableImport
      .mockResolvedValueOnce({ state: 'passphrase-required' })
      .mockResolvedValueOnce({
        state: 'preview',
        preview: {
          currentRevision: 0,
          encrypted: true,
          envelope: {} as never,
          changes: {
            categories: {} as never,
            totals: { added: 1, changed: 0, removed: 0, unchanged: 0 },
            tombstones: 0
          },
          merge: { state: 'unavailable', code: 'profile-mismatch' }
        }
      })
    hookMocks.useDataTools.mockReturnValue(tools)
    const view = await mount(panel())
    const input = view.container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('File input not found.')
    }
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['encrypted'], 'profile.encrypted.json')]
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(view.container.textContent).toContain('dataImportEncryptedTitle')
    const passphrases = view.container.querySelectorAll(
      'input[type="password"]'
    )
    const importPassphrase = passphrases.item(passphrases.length - 1)
    if (!(importPassphrase instanceof HTMLInputElement)) {
      throw new Error('Import passphrase field not found.')
    }
    await changeValue(importPassphrase, 'portable profile password')
    await click(button(view.container, 'dataImportUnlockAction'))

    expect(tools.previewPortableImport).toHaveBeenLastCalledWith(
      'encrypted',
      'portable profile password'
    )
    expect(view.container.textContent).toContain('dataImportPreviewTitle')
  })

  it('exports the portable profile and renders blocked empty diagnostics', async () => {
    const tools = readyTools()
    tools.state = {
      status: 'ready',
      diagnostics: [],
      importSnapshotAvailable: false,
      portableImportSnapshotAvailable: false,
      recovery: {
        state: 'blocked-unreadable',
        primaryAction: 'reset',
        actions: ['reset'],
        preserved: []
      }
    } as never
    hookMocks.useDataTools.mockReturnValue(tools)
    const view = await mount(panel())

    expect(view.container.textContent).toContain('dataNoDiagnostics')
    expect(view.container.textContent).toContain('dataRecoveryBlocked')
    const passphrases = view.container.querySelectorAll(
      'input[type="password"]'
    )
    if (
      !(passphrases[0] instanceof HTMLInputElement) ||
      !(passphrases[1] instanceof HTMLInputElement)
    ) {
      throw new Error('Passphrase fields not found.')
    }
    await changeValue(passphrases[0], 'correct horse battery staple')
    await changeValue(passphrases[1], 'correct horse battery staple')
    await click(button(view.container, 'dataExportEncryptedAction'))
    expect(tools.exportPortableEncrypted).toHaveBeenCalledOnce()
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
  })

  it('validates encrypted export and confirms an explicit plaintext export', async () => {
    const tools = readyTools()
    hookMocks.useDataTools.mockReturnValue(tools)
    const view = await mount(panel())

    await click(button(view.container, 'dataExportEncryptedAction'))
    expect(view.container.textContent).toContain(
      'dataExportPassphraseMismatchError'
    )
    const passphrases = view.container.querySelectorAll(
      'input[type="password"]'
    )
    if (
      !(passphrases[0] instanceof HTMLInputElement) ||
      !(passphrases[1] instanceof HTMLInputElement)
    ) {
      throw new Error('Passphrase fields not found.')
    }
    tools.exportPortableEncrypted.mockRejectedValueOnce(
      new Error('export failed')
    )
    await changeValue(passphrases[0], 'correct horse battery staple')
    await changeValue(passphrases[1], 'correct horse battery staple')
    await click(button(view.container, 'dataExportEncryptedAction'))
    expect(view.container.textContent).toContain('dataErrorTitle')

    await click(radio(view.container, 'dataExportPlaintextLabel'))
    await click(button(view.container, 'dataExportPlaintextReviewAction'))
    await click(button(view.container, 'dataCancelAction'))
    await click(button(view.container, 'dataExportPlaintextReviewAction'))
    await click(button(view.container, 'dataExportPlaintextConfirmAction'))
    expect(tools.exportPortablePlaintext).toHaveBeenCalledOnce()
  })

  it('reports failed maintenance and retries a portable snapshot restore', async () => {
    const tools = readyTools()
    tools.state = {
      ...tools.state,
      portableImportSnapshotAvailable: true
    } as never
    tools.clearDiagnostics.mockResolvedValueOnce(false)
    tools.restorePortableImportSnapshot
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('committed')
    tools.reset.mockResolvedValueOnce('failed')
    hookMocks.useDataTools.mockReturnValue(tools)
    const view = await mount(panel())

    await click(button(view.container, 'dataClearDiagnosticsAction'))
    await click(button(view.container, 'dataConfirmClearDiagnosticsAction'))
    expect(view.container.textContent).toContain('dataErrorTitle')

    await click(button(view.container, 'dataRestorePortableImportAction'))
    expect(view.container.textContent).toContain('dataPendingTitle')
    await click(button(view.container, 'dataPendingAction'))
    expect(tools.restorePortableImportSnapshot).toHaveBeenCalledTimes(2)

    await click(button(view.container, 'dataReviewResetAction'))
    await click(button(view.container, 'dataConfirmResetAction'))
    expect(view.container.textContent).toContain('dataErrorTitle')
  })

  it('requires every merge conflict to be selected before resolution', async () => {
    const tools = readyTools()
    const conflictPreview = {
      currentRevision: 1,
      encrypted: false,
      envelope: {} as never,
      changes: {
        categories: {} as never,
        totals: { added: 0, changed: 1, removed: 0, unchanged: 0 },
        tombstones: 0
      },
      merge: {
        state: 'conflict' as const,
        conflicts: [
          {
            entityType: 'portableProviders' as const,
            entityId: 'provider:unselected',
            reason: 'concurrent-change' as const,
            base: { kind: 'absent' as const },
            local: { kind: 'value' as const, value: { name: 'Local' } },
            remote: { kind: 'value' as const, value: { name: 'Remote' } }
          }
        ],
        localEnvelope: {} as never,
        result: {} as never
      }
    } satisfies PortableImportPreview
    tools.previewPortableImport.mockResolvedValueOnce({
      state: 'preview',
      preview: conflictPreview
    })
    hookMocks.useDataTools.mockReturnValue(tools)
    const view = await mount(panel())
    const input = view.container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('File input not found.')
    }
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['conflict'], 'conflict.json')]
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    await click(button(view.container, 'dataImportConflictValidateAction'))
    expect(view.container.textContent).toContain(
      'dataImportConflictResolutionErrorTitle'
    )
    expect(tools.resolvePortableConflicts).not.toHaveBeenCalled()

    await click(radio(view.container, 'dataImportConflictEditLabel'))
    const textarea = view.container.querySelector('textarea')
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('Custom conflict editor not found.')
    }
    await changeTextarea(textarea, 'not-json')
    await click(button(view.container, 'dataImportConflictValidateAction'))
    expect(view.container.textContent).toContain('dataImportConflictJsonError')

    await changeTextarea(textarea, '{"displayName":"Custom"}')
    await click(button(view.container, 'dataImportConflictValidateAction'))
    expect(tools.resolvePortableConflicts).toHaveBeenCalledWith(
      conflictPreview,
      [
        expect.objectContaining({
          choice: 'custom',
          customValue: { displayName: 'Custom' }
        })
      ]
    )
  })

  it('requires confirmation for bulk conflict choices before validating merge', async () => {
    const tools = readyTools()
    const conflictPreview = {
      currentRevision: 1,
      encrypted: false,
      envelope: {} as never,
      changes: {
        categories: {} as never,
        totals: { added: 0, changed: 1, removed: 0, unchanged: 0 },
        tombstones: 0
      },
      merge: {
        state: 'conflict' as const,
        conflicts: [
          {
            entityType: 'portableProviders' as const,
            entityId: 'provider:one',
            reason: 'concurrent-change' as const,
            base: { kind: 'value' as const, value: { displayName: 'Base' } },
            local: {
              kind: 'value' as const,
              value: { displayName: 'Local' }
            },
            remote: {
              kind: 'value' as const,
              value: { displayName: 'Remote' }
            }
          }
        ],
        localEnvelope: {} as never,
        result: {} as never
      }
    } satisfies PortableImportPreview
    const resolvedPreview = {
      ...conflictPreview,
      merge: { state: 'ready' as const, candidate: {} as never }
    } satisfies PortableImportPreview
    tools.previewPortableImport.mockResolvedValueOnce({
      state: 'preview',
      preview: conflictPreview
    })
    tools.resolvePortableConflicts.mockResolvedValueOnce({
      state: 'resolved',
      preview: resolvedPreview
    })
    hookMocks.useDataTools.mockReturnValue(tools)
    const view = await mount(panel())
    const input = view.container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('File input not found.')
    }
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['conflict'], 'conflict.json')]
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    await click(button(view.container, 'dataImportConflictAllLocalAction'))
    expect(view.container.textContent).toContain(
      'dataImportConflictBulkReviewTitle'
    )
    await click(button(view.container, 'dataImportConflictBulkConfirmAction'))
    await click(button(view.container, 'dataImportConflictValidateAction'))

    expect(tools.resolvePortableConflicts).toHaveBeenCalledWith(
      conflictPreview,
      [
        expect.objectContaining({
          entityType: 'portableProviders',
          entityId: 'provider:one',
          choice: 'local'
        })
      ]
    )
    expect(view.container.textContent).toContain('dataImportMergeReviewAction')
  })
})

describe('rule workbench interactions', () => {
  const workbench = (
    profile: ProfileEnvelope,
    onSave = vi.fn<RuleWorkbenchProps['onSave']>(async () => ({ ok: true })),
    onRemove = vi.fn<RuleWorkbenchProps['onRemove']>(async () => ({
      ok: true
    })),
    onOpenData = vi.fn()
  ) => (
    <RuleWorkbench
      copy={ruleCopy}
      onOpenData={onOpenData}
      onRemove={onRemove}
      onSave={onSave}
      pending={false}
      profile={profile}
    />
  )

  it('validates, previews, goes back and saves a first rule', async () => {
    const onSave = vi.fn(async () => ({ ok: true as const }))
    const view = await mount(workbench(profileWith([]), onSave))

    await click(button(view.container, 'rulesCreateAction'))
    const form = view.container.querySelector('form')
    if (!(form instanceof HTMLFormElement)) {
      throw new Error('Rule form not found.')
    }
    await submit(form)
    expect(view.container.textContent).toContain('rulesPhraseError')

    const phrase = view.container.querySelector('.cl-field__control')
    if (!(phrase instanceof HTMLInputElement)) {
      throw new Error('Rule inputs not found.')
    }
    await changeValue(phrase, 'tactical analysis')
    await click(radio(view.container, 'rulesAllowLabel'))
    await submit(form)
    expect(view.container.textContent).toContain('rulesPreviewTitle')
    expect(view.container.textContent).toContain('youtube:home')
    expect(
      view.container.querySelectorAll(
        '.rule-preview__decision[data-changed="true"]'
      )
    ).toHaveLength(1)
    expect(
      view.container.querySelectorAll(
        '.rule-preview__decision[data-changed="false"]'
      )
    ).toHaveLength(1)

    await click(button(view.container, 'rulesBackAction'))
    expect(view.container.textContent).toContain('rulesEditorUpdateTitle')
    await submit(view.container.querySelector('form') as HTMLFormElement)
    await click(button(view.container, 'rulesSaveAction'))

    expect(onSave).toHaveBeenCalledOnce()
    expect(view.container.textContent).toContain('rulesSavedTitle')
  })

  it('keeps a failed preview and allows cancellation', async () => {
    const onSave = vi.fn<RuleWorkbenchProps['onSave']>(async () => ({
      ok: false,
      state: 'failed',
      code: 'rule-save-failed'
    }))
    const view = await mount(workbench(profileWith([]), onSave))
    await click(button(view.container, 'rulesCreateAction'))
    const phrase = view.container.querySelector('.cl-field__control')
    if (!(phrase instanceof HTMLInputElement)) {
      throw new Error('Rule phrase input not found.')
    }
    await changeValue(phrase, 'rumor')
    await submit(view.container.querySelector('form') as HTMLFormElement)
    await click(button(view.container, 'rulesSaveAction'))

    expect(view.container.textContent).toContain('rulesFailureTitle')
    await click(button(view.container, 'rulesBackAction'))
    await click(button(view.container, 'rulesCancelAction'))
    expect(view.container.textContent).toContain('rulesListTitle')
  })

  it('keeps pending save and undo operations truthful and retryable', async () => {
    const savedRule = exactRule('rule:exact:pending')
    const onSave = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, state: 'pending' })
      .mockResolvedValueOnce({ ok: true })
    const onRemove = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, state: 'pending' })
      .mockResolvedValueOnce({ ok: true })
    const view = await mount(workbench(profileWith([]), onSave, onRemove))

    await click(button(view.container, 'rulesCreateAction'))
    const phrase = view.container.querySelector('.cl-field__control')
    if (!(phrase instanceof HTMLInputElement)) {
      throw new Error('Rule phrase input not found.')
    }
    await changeValue(phrase, savedRule.value)
    await submit(view.container.querySelector('form') as HTMLFormElement)
    await click(button(view.container, 'rulesSaveAction'))

    expect(view.container.textContent).toContain('rulesPendingTitle')
    expect(view.container.textContent).not.toContain('rulesFailureTitle')
    await click(button(view.container, 'rulesPendingAction'))
    expect(view.container.textContent).toContain('rulesSavedTitle')

    await view.render(workbench(profileWith([savedRule]), onSave, onRemove))
    await click(button(view.container, 'rulesUndoAction'))
    expect(view.container.textContent).toContain('rulesPendingTitle')
    expect(view.container.textContent).not.toContain('rulesFailureTitle')
    await click(button(view.container, 'rulesPendingAction'))
    expect(view.container.textContent).toContain('rulesUndoneTitle')

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onRemove).toHaveBeenCalledTimes(2)
  })

  it('edits exact rules, disables advanced rules and opens data', async () => {
    const advanced = {
      ...exactRule('rule:advanced'),
      kind: 'compound'
    } as unknown as Rule
    const onOpenData = vi.fn()
    const view = await mount(
      workbench(
        profileWith([exactRule(), advanced]),
        undefined,
        undefined,
        onOpenData
      )
    )

    const editButtons = [...view.container.querySelectorAll('button')].filter(
      candidate => candidate.textContent === 'rulesEditAction'
    )
    expect(editButtons).toHaveLength(2)
    expect(editButtons[1]).toHaveProperty('disabled', true)
    await click(editButtons[0] as HTMLButtonElement)
    expect(view.container.textContent).toContain('rulesEditorUpdateTitle')
    await click(button(view.container, 'rulesCancelAction'))
    await click(button(view.container, 'rulesDataAction'))
    expect(onOpenData).toHaveBeenCalledOnce()
  })

  it('offers undo after a save and reports an undo failure', async () => {
    const savedRule = exactRule('rule:exact:saved')
    const onSave = vi.fn(async () => ({ ok: true as const }))
    const onRemove = vi.fn(async () => ({
      ok: false as const,
      state: 'failed' as const,
      code: 'rule-remove-failed'
    }))
    const view = await mount(workbench(profileWith([]), onSave, onRemove))
    await click(button(view.container, 'rulesCreateAction'))
    const phrase = view.container.querySelector('.cl-field__control')
    if (!(phrase instanceof HTMLInputElement)) {
      throw new Error('Rule phrase input not found.')
    }
    await changeValue(phrase, savedRule.value)
    await submit(view.container.querySelector('form') as HTMLFormElement)
    await click(button(view.container, 'rulesSaveAction'))
    await view.render(workbench(profileWith([savedRule]), onSave, onRemove))
    await click(button(view.container, 'rulesUndoAction'))

    expect(onRemove).toHaveBeenCalledOnce()
    expect(view.container.textContent).toContain('rulesFailureTitle')
  })
})
