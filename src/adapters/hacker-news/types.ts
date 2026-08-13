import type { ContentIdentity } from '@/core/content/contracts'

export const HACKER_NEWS_SURFACES = [
  'front-page',
  'new',
  'best',
  'ask',
  'show',
  'jobs',
  'item'
] as const

export type HackerNewsSurface = (typeof HACKER_NEWS_SURFACES)[number]

export type HackerNewsCandidate = {
  age?: string
  authorDisplayName?: string
  commentCount?: number
  destinationHost?: string
  destinationUrl?: string
  domId: string
  durableItemActions: boolean
  identity: ContentIdentity
  pageInstanceId: string
  points?: number
  surface: Exclude<HackerNewsSurface, 'item'>
  title: string
}
