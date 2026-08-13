import { z } from 'zod'

import { type RssAcquisitionResult, rssFeedIdSchema } from '@/adapters/rss'
import type {
  SettingsRequestMessage,
  SettingsRuntimeResponse
} from '@/application/settings/runtime-contracts'
import {
  contentItemSchema,
  nonEmptyStringSchema,
  platformSchema
} from '@/core/content/contracts'
import { decisionActionSchema } from '@/core/decisions/contracts'

export const CONTENT_LENS_MESSAGE_NAMESPACE = 'contentlens.runtime.v1'
export const MAX_RUNTIME_MESSAGE_BYTES = 64 * 1024
export const DEFAULT_MESSAGE_RATE_LIMIT = 120
export const DEFAULT_MESSAGE_RATE_WINDOW_MS = 60_000

export const decisionRequestMessageSchema = z
  .strictObject({
    namespace: z.literal(CONTENT_LENS_MESSAGE_NAMESPACE),
    version: z.literal(1),
    type: z.literal('decision.request'),
    platform: platformSchema,
    requestId: nonEmptyStringSchema,
    pageInstanceId: nonEmptyStringSchema,
    item: contentItemSchema
  })
  .refine(message => message.item.platform === message.platform, {
    message: 'Item platform must match the message platform namespace',
    path: ['item', 'platform']
  })
  .refine(
    message => message.item.surface.startsWith(`${message.item.platform}:`),
    {
      message: 'Item surface must match the item platform namespace',
      path: ['item', 'surface']
    }
  )

export type DecisionRequestMessage = z.infer<
  typeof decisionRequestMessageSchema
>

export const rssRevalidateMessageSchema = z.strictObject({
  namespace: z.literal(CONTENT_LENS_MESSAGE_NAMESPACE),
  version: z.literal(1),
  type: z.literal('rss.revalidate'),
  requestId: nonEmptyStringSchema,
  feedId: rssFeedIdSchema
})

export type RssRevalidateMessage = z.infer<typeof rssRevalidateMessageSchema>

export const rssCancelMessageSchema = z.strictObject({
  namespace: z.literal(CONTENT_LENS_MESSAGE_NAMESPACE),
  version: z.literal(1),
  type: z.literal('rss.cancel'),
  requestId: nonEmptyStringSchema,
  feedId: rssFeedIdSchema
})

export type RssCancelMessage = z.infer<typeof rssCancelMessageSchema>
export type RuntimeRequestMessage =
  | DecisionRequestMessage
  | RssCancelMessage
  | RssRevalidateMessage
  | SettingsRequestMessage

export type RuntimeMessageRejectionCode =
  | 'invalid-namespace'
  | 'unknown-message-type'
  | 'invalid-message'
  | 'message-too-large'
  | 'untrusted-sender'
  | 'rate-limited'
  | 'processing-failed'

export const runtimeDecisionSchema = z.strictObject({
  action: decisionActionSchema,
  profileRevision: z.int().nonnegative(),
  reasonCode: z.enum([
    'default-show',
    'deterministic-rule',
    'model-policy',
    'rule-conflict',
    'similarity-policy'
  ])
})

export type RuntimeDecision = z.infer<typeof runtimeDecisionSchema>

export type RuntimeMessageResponse =
  | {
      state: 'acknowledged'
      requestId: string
      decision?: RuntimeDecision
      rss?: RssAcquisitionResult
      settings?: SettingsRuntimeResponse
    }
  | {
      state: 'rejected'
      code: RuntimeMessageRejectionCode
    }
