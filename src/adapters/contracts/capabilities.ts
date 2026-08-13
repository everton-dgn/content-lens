export const ADAPTER_CAPABILITY_STATES = [
  'supported',
  'degraded',
  'disabled',
  'unsupported'
] as const

export type AdapterCapabilityState = (typeof ADAPTER_CAPABILITY_STATES)[number]

export const ADAPTER_CAPABILITY_IDS = [
  'observe-candidates',
  'extract-content',
  'render-show',
  'render-promote',
  'render-reduce',
  'render-hide',
  'render-review',
  'identity-item',
  'identity-author',
  'identity-channel',
  'identity-subreddit',
  'identity-source'
] as const

export type AdapterCapabilityId = (typeof ADAPTER_CAPABILITY_IDS)[number]

export type AdapterCapabilityStatus = {
  state: AdapterCapabilityState
  code: string
}

export type AdapterCapabilityMap = Readonly<
  Record<AdapterCapabilityId, AdapterCapabilityStatus>
>

export const ADAPTER_RELATION_KINDS = [
  'repost',
  'quote',
  'reply',
  'crosspost',
  'thread-parent',
  'thread-root',
  'recommendation-source'
] as const

export type AdapterRelationKind = (typeof ADAPTER_RELATION_KINDS)[number]

export const CONTENT_TRAITS = [
  'promoted',
  'sponsored',
  'short-form',
  'live',
  'poll',
  'native-ad'
] as const

export type ContentTrait = (typeof CONTENT_TRAITS)[number]

export const ADAPTER_EXTRACTABLE_FIELDS = [
  'identity',
  'title',
  'body',
  'author',
  'channel',
  'media',
  'published-at',
  'language',
  'context',
  'relations',
  'traits'
] as const

export type AdapterExtractableField =
  (typeof ADAPTER_EXTRACTABLE_FIELDS)[number]

export const ADAPTER_VISUAL_ACTIONS = [
  'show',
  'promote',
  'reduce',
  'hide',
  'review'
] as const

export type AdapterVisualAction = (typeof ADAPTER_VISUAL_ACTIONS)[number]

export const ADAPTER_BROWSER_NAMES = ['chrome', 'firefox'] as const

export type AdapterBrowserName = (typeof ADAPTER_BROWSER_NAMES)[number]
