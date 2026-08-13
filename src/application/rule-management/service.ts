import {
  comparePortableStrings,
  fingerprintPortableValue
} from '@/core/operations/fingerprint'
import type {
  OperationCommand,
  OperationResponse
} from '@/core/operations/journal'
import { type Rule, ruleSchema } from '@/core/rules/contracts/rule'
import {
  type ContentLensDatabase,
  ProfileTransactionError
} from '@/storage/indexed-db/database'

export type SaveRuleCommand = {
  operationId: string
  expectedRevision: number
  rule: unknown
  at: string
}

export type RemoveRuleCommand = {
  operationId: string
  expectedRevision: number
  ruleId: string
  at: string
}

type SaveRuleResult = {
  ruleId: string
}

function invalidRule(): OperationResponse<SaveRuleResult> {
  return {
    state: 'failed',
    error: {
      code: 'invalid-rule',
      message: 'Rule input is invalid'
    },
    retryable: false
  }
}

async function saveOperationCommand(
  input: SaveRuleCommand,
  rule: Rule
): Promise<OperationCommand> {
  return {
    operationId: input.operationId,
    type: 'rule.save',
    targetFingerprint: await fingerprintPortableValue({
      expectedRevision: input.expectedRevision,
      rule
    }),
    at: input.at
  }
}

async function removeOperationCommand(
  input: RemoveRuleCommand
): Promise<OperationCommand> {
  return {
    operationId: input.operationId,
    type: 'rule.remove',
    targetFingerprint: await fingerprintPortableValue({
      expectedRevision: input.expectedRevision,
      ruleId: input.ruleId
    }),
    at: input.at
  }
}

export class RuleManagementService {
  readonly #database: ContentLensDatabase

  constructor(database: ContentLensDatabase) {
    this.#database = database
  }

  async acknowledgeSave(
    input: SaveRuleCommand
  ): Promise<OperationResponse<SaveRuleResult>> {
    const parsed = ruleSchema.safeParse(input.rule)
    if (!parsed.success) {
      return invalidRule()
    }
    const command = await saveOperationCommand(input, parsed.data)
    return this.#database.acknowledgeOperation(command)
  }

  async save(
    input: SaveRuleCommand
  ): Promise<OperationResponse<SaveRuleResult>> {
    const parsed = ruleSchema.safeParse(input.rule)
    if (!parsed.success) {
      return invalidRule()
    }
    const command = await saveOperationCommand(input, parsed.data)

    return this.#database.transactProfile(
      command,
      input.expectedRevision,
      current => {
        const rules = current.rules.filter(rule => rule.id !== parsed.data.id)
        rules.push(parsed.data)
        rules.sort((left, right) => comparePortableStrings(left.id, right.id))
        return {
          profile: {
            ...current,
            revision: current.revision + 1,
            updatedAt: input.at,
            rules
          },
          value: {
            ruleId: parsed.data.id
          },
          effects: [
            {
              kind: 'rule.saved',
              targetId: parsed.data.id
            }
          ]
        }
      }
    )
  }

  async acknowledgeRemove(
    input: RemoveRuleCommand
  ): Promise<OperationResponse<SaveRuleResult>> {
    return this.#database.acknowledgeOperation(
      await removeOperationCommand(input)
    )
  }

  async remove(
    input: RemoveRuleCommand
  ): Promise<OperationResponse<SaveRuleResult>> {
    return this.#database.transactProfile(
      await removeOperationCommand(input),
      input.expectedRevision,
      profile => {
        if (!profile.rules.some(rule => rule.id === input.ruleId)) {
          throw new ProfileTransactionError(
            'rule-not-found',
            'The rule is no longer available',
            false
          )
        }
        return {
          profile: {
            ...profile,
            revision: profile.revision + 1,
            updatedAt: input.at,
            rules: profile.rules.filter(rule => rule.id !== input.ruleId)
          },
          value: {
            ruleId: input.ruleId
          },
          effects: [
            {
              kind: 'rule.removed',
              targetId: input.ruleId
            }
          ]
        }
      }
    )
  }
}
