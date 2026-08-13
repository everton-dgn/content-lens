import type { ChangeEvent } from 'react'

import type { SyncConflictRecord } from '@/sync/three-way-merge'
import { ChoiceGroup, TextareaField } from '@/ui/components'
import type { DataPanelCopy } from '@/ui/data/copy'

export type PortableConflictDraft = {
  choice: 'unselected' | 'local' | 'remote' | 'custom'
  customValue: string
  error?: string
}

type PortableConflictEditorProps = {
  conflict: SyncConflictRecord
  copy: DataPanelCopy
  draft: PortableConflictDraft
  onChange: (
    entityType: SyncConflictRecord['entityType'],
    entityId: string,
    draft: PortableConflictDraft
  ) => void
}

function present(value: unknown) {
  return JSON.stringify(value, null, 2)
}

export const PortableConflictEditor = ({
  conflict,
  copy,
  draft,
  onChange
}: PortableConflictEditorProps) => {
  const changeChoice = (choice: PortableConflictDraft['choice']) => {
    onChange(conflict.entityType, conflict.entityId, {
      ...draft,
      choice,
      error: undefined
    })
  }
  const changeCustomValue = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(conflict.entityType, conflict.entityId, {
      ...draft,
      customValue: event.currentTarget.value,
      error: undefined
    })
  }

  return (
    <article className="data-conflict" data-slot="portable-conflict">
      <div className="data-conflict__heading">
        <strong>{copy.importConflictItemTitle}</strong>
        <span>{`${conflict.entityType} / ${conflict.entityId}`}</span>
      </div>
      <div className="data-conflict__values">
        <section>
          <strong>{copy.importConflictLocalLabel}</strong>
          <pre>{present(conflict.local)}</pre>
        </section>
        <section>
          <strong>{copy.importConflictRemoteLabel}</strong>
          <pre>{present(conflict.remote)}</pre>
        </section>
      </div>
      <ChoiceGroup
        label={copy.importConflictChoiceLabel}
        name={`conflict:${conflict.entityType}:${conflict.entityId}`}
        onChange={changeChoice}
        options={[
          {
            value: 'unselected',
            label: copy.importConflictUnselectedLabel
          },
          { value: 'local', label: copy.importConflictUseLocalLabel },
          { value: 'remote', label: copy.importConflictUseRemoteLabel },
          { value: 'custom', label: copy.importConflictEditLabel }
        ]}
        value={draft.choice}
      />
      {draft.choice === 'custom' ? (
        <TextareaField
          error={draft.error}
          hint={copy.importConflictEditHint}
          label={copy.importConflictEditValueLabel}
          onChange={changeCustomValue}
          rows={6}
          spellCheck={false}
          value={draft.customValue}
        />
      ) : null}
    </article>
  )
}
