import { ArrowRight } from 'lucide-react'
import {
  type ChangeEvent,
  type MouseEvent,
  type SyntheticEvent,
  useReducer,
  useState
} from 'react'

import type { ExactRule, Rule } from '@/core/rules/contracts/rule'
import type { ProfileEnvelope } from '@/storage/contracts/profile-envelope'
import {
  Badge,
  Button,
  ChoiceGroup,
  Field,
  Notice,
  StatePanel,
  Surface
} from '@/ui/components'
import type { RuleWorkbenchCopy } from '@/ui/rules/copy'
import {
  draftFromRule,
  exactRuleFromDraft,
  initialRuleFlowState,
  previewExactRule,
  type RuleEffect,
  ruleFlowReducer
} from '@/ui/rules/model'
import type { RuleMutationOutcome } from '@/ui/rules/useRuleProfile'

export type RuleWorkbenchProps = {
  copy: RuleWorkbenchCopy
  onOpenData: () => void
  onRemove: (ruleId: string) => Promise<RuleMutationOutcome>
  onSave: (rule: Rule) => Promise<RuleMutationOutcome>
  pending: boolean
  profile: ProfileEnvelope
}

const isExactRule = (rule: Rule): rule is ExactRule => rule.kind === 'exact'

export const RuleWorkbench = ({
  copy,
  onOpenData,
  onRemove,
  onSave,
  pending,
  profile
}: RuleWorkbenchProps) => {
  const [flow, dispatch] = useReducer(ruleFlowReducer, initialRuleFlowState)
  const [fieldError, setFieldError] = useState<string>()

  const effectOptions = [
    {
      value: 'block',
      label: copy.blockLabel,
      description: copy.blockDescription
    },
    {
      value: 'allow',
      label: copy.allowLabel,
      description: copy.allowDescription
    }
  ] as const

  const startRule = () => {
    dispatch({ type: 'start' })
  }
  const cancelRule = () => {
    dispatch({ type: 'cancel' })
  }
  const backToEditor = () => {
    dispatch({ type: 'back-to-editor' })
  }
  const updateEffect = (effect: RuleEffect) => {
    if (flow.screen === 'editor') {
      dispatch({ type: 'update', draft: { ...flow.draft, effect } })
    }
  }
  const updatePhrase = (event: ChangeEvent<HTMLInputElement>) => {
    if (flow.screen === 'editor') {
      dispatch({
        type: 'update',
        draft: { ...flow.draft, value: event.currentTarget.value }
      })
    }
  }
  const submitRule = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault()
    if (flow.screen !== 'editor') {
      return
    }
    if (flow.draft.value.trim().length < 2) {
      setFieldError(copy.phraseError)
      return
    }
    setFieldError(undefined)
    const at = new Date().toISOString()
    const candidate = exactRuleFromDraft(flow.draft, {
      at,
      id: `rule:exact:${crypto.randomUUID()}`
    })
    dispatch({
      type: 'preview',
      preview: previewExactRule(
        profile.rules,
        candidate,
        profile.revision,
        at,
        copy.previewProtectedItemTitle
      )
    })
  }
  const savePreview = async () => {
    if (flow.screen !== 'preview') {
      return
    }
    const outcome = await onSave(flow.preview.candidate)
    if (outcome.ok) {
      dispatch({ type: 'saved', rule: flow.preview.candidate })
      return
    }
    dispatch(
      outcome.state === 'pending'
        ? { type: 'save-pending' }
        : { type: 'save-failed' }
    )
  }
  const undoSavedRule = async () => {
    if (
      flow.screen !== 'list' ||
      (flow.feedback?.kind !== 'saved' &&
        flow.feedback?.kind !== 'undo-pending')
    ) {
      return
    }
    const savedRule = flow.feedback.rule
    const outcome = await onRemove(savedRule.id)
    if (outcome.ok) {
      dispatch({ type: 'undone' })
      return
    }
    dispatch(
      outcome.state === 'pending'
        ? { type: 'undo-pending', rule: savedRule }
        : { type: 'undo-failed' }
    )
  }
  const editRule = (event: MouseEvent<HTMLButtonElement>) => {
    const rule = profile.rules.find(
      candidate => candidate.id === event.currentTarget.dataset.ruleId
    )
    if (rule && isExactRule(rule)) {
      dispatch({
        type: 'start',
        draft: draftFromRule(rule)
      })
    }
  }

  if (flow.screen === 'editor') {
    return (
      <form
        aria-busy={pending}
        className="rule-editor"
        data-slot="rule-editor"
        onSubmit={submitRule}
      >
        <div className="rule-workbench__heading">
          <p>{copy.editorEyebrow}</p>
          <h2>
            {flow.draft.id ? copy.editorUpdateTitle : copy.editorNewTitle}
          </h2>
          <span>{copy.editorDescription}</span>
        </div>
        <ChoiceGroup
          label={copy.editorEffectLabel}
          name="rule-effect"
          onChange={updateEffect}
          options={effectOptions}
          value={flow.draft.effect}
        />
        <Field
          autoComplete="off"
          error={fieldError}
          hint={copy.phraseHint}
          label={copy.phraseLabel}
          onChange={updatePhrase}
          value={flow.draft.value}
        />
        <div className="rule-workbench__actions">
          <Button disabled={pending} size="full" type="submit">
            {copy.previewAction}
          </Button>
          <Button
            disabled={pending}
            onClick={cancelRule}
            size="full"
            variant="quiet"
          >
            {copy.cancelAction}
          </Button>
        </div>
      </form>
    )
  }

  if (flow.screen === 'preview') {
    return (
      <section
        aria-busy={pending}
        className="rule-preview"
        data-slot="rule-preview"
      >
        <div className="rule-workbench__heading">
          <p>{copy.previewEyebrow}</p>
          <h2>{copy.previewTitle}</h2>
          <span>{copy.previewDescription}</span>
        </div>
        <div className="rule-preview__grid">
          {flow.preview.outcomes.map(outcome => (
            <Surface key={outcome.kind}>
              <div
                className="rule-preview__outcome"
                data-changed={outcome.before !== outcome.after}
                data-result={outcome.after}
              >
                <div className="rule-preview__meta">
                  <Badge tone={outcome.matched ? 'info' : 'success'}>
                    {outcome.kind === 'match'
                      ? copy.previewMatchLabel
                      : copy.previewProtectedLabel}
                  </Badge>
                  <span className="rule-preview__source">
                    {outcome.platform} · <code>{outcome.surface}</code>
                  </span>
                </div>
                <strong>{outcome.title}</strong>
                <div
                  className="rule-preview__decision"
                  data-changed={outcome.changed}
                >
                  <span className="rule-preview__before">
                    {outcome.before === 'hide'
                      ? copy.hideLabel
                      : copy.showLabel}
                  </span>
                  <span aria-hidden="true">→</span>
                  <Badge tone={outcome.after === 'hide' ? 'info' : 'success'}>
                    {outcome.after === 'hide' ? copy.hideLabel : copy.showLabel}
                  </Badge>
                </div>
                {!outcome.matched ? (
                  <p className="rule-preview__description">
                    {copy.unchangedLabel}
                  </p>
                ) : null}
              </div>
            </Surface>
          ))}
        </div>
        {flow.pending ? (
          <Notice
            body={copy.pendingBody}
            title={copy.pendingTitle}
            tone="info"
          />
        ) : flow.failure ? (
          <Notice
            body={copy.failureBody}
            title={copy.failureTitle}
            tone="error"
          />
        ) : null}
        <div className="rule-workbench__actions">
          <Button disabled={pending} onClick={savePreview} size="full">
            {pending
              ? copy.savingAction
              : flow.pending
                ? copy.pendingAction
                : copy.saveAction}
          </Button>
          <Button
            disabled={pending}
            onClick={backToEditor}
            size="full"
            variant="quiet"
          >
            {copy.backAction}
          </Button>
        </div>
      </section>
    )
  }

  const feedback =
    flow.feedback?.kind === 'saved'
      ? {
          title: copy.savedTitle,
          body: copy.savedBody,
          tone: 'success' as const
        }
      : flow.feedback?.kind === 'undone'
        ? {
            title: copy.undoneTitle,
            body: copy.undoneBody,
            tone: 'success' as const
          }
        : flow.feedback?.kind === 'undo-pending'
          ? {
              title: copy.pendingTitle,
              body: copy.pendingBody,
              tone: 'info' as const
            }
          : flow.feedback?.kind === 'failed'
            ? {
                title: copy.failureTitle,
                body: copy.failureBody,
                tone: 'error' as const
              }
            : undefined

  if (profile.rules.length === 0) {
    return (
      <StatePanel
        description={copy.listDescription}
        eyebrow={copy.listEyebrow}
        primaryAction={
          <Button disabled={pending} onClick={startRule} size="full">
            {copy.createAction}
          </Button>
        }
        state="empty"
        title={copy.listTitle}
      >
        {feedback ? (
          <Notice
            body={feedback.body}
            title={feedback.title}
            tone={feedback.tone}
          />
        ) : null}
        <Surface>
          <div className="panel-privacy">
            <Badge tone="neutral">{copy.privacyBadge}</Badge>
            <div>
              <h3>{copy.privacyTitle}</h3>
              <p>{copy.privacyDescription}</p>
            </div>
          </div>
        </Surface>
        <Button onClick={onOpenData} size="full" variant="secondary">
          {copy.dataAction}
          <ArrowRight aria-hidden="true" />
        </Button>
      </StatePanel>
    )
  }

  return (
    <section
      aria-busy={pending}
      className="rule-workbench"
      data-slot="rule-workbench"
    >
      <div className="rule-workbench__toolbar">
        <div className="rule-workbench__heading">
          <p>{copy.listEyebrow}</p>
          <h2>{copy.listTitle}</h2>
          <span>{copy.listDescription}</span>
        </div>
        <div className="rule-workbench__toolbar-actions">
          <Button onClick={onOpenData} size="compact" variant="secondary">
            {copy.dataAction}
          </Button>
          <Button disabled={pending} onClick={startRule} size="compact">
            {copy.newAction}
          </Button>
        </div>
      </div>
      {feedback ? (
        <div className="rule-workbench__feedback">
          <Notice
            body={feedback.body}
            title={feedback.title}
            tone={feedback.tone}
          />
          {flow.feedback?.kind === 'saved' ||
          flow.feedback?.kind === 'undo-pending' ? (
            <Button
              disabled={pending}
              onClick={undoSavedRule}
              size="full"
              variant="secondary"
            >
              {flow.feedback.kind === 'undo-pending'
                ? copy.pendingAction
                : copy.undoAction}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="rule-list">
        {profile.rules.map(rule => {
          const exact = isExactRule(rule)
          return (
            <Surface key={rule.id}>
              <article className="rule-card">
                <div className="rule-card__copy">
                  <Badge tone="neutral">
                    {exact
                      ? rule.effect === 'allow'
                        ? copy.allowLabel
                        : copy.blockLabel
                      : copy.advancedRuleLabel}
                  </Badge>
                  <strong>{exact ? rule.value : copy.advancedRuleLabel}</strong>
                  <span>{copy.ruleScope}</span>
                </div>
                <Button
                  data-rule-id={rule.id}
                  disabled={pending || !exact}
                  onClick={editRule}
                  size="compact"
                  variant="secondary"
                >
                  {copy.editAction}
                </Button>
              </article>
            </Surface>
          )
        })}
      </div>
    </section>
  )
}
