import { z } from 'zod'

import type { Platform } from '@/core/content/contracts'

export const PLATFORM_SURFACES = {
  youtube: [
    'home',
    'search',
    'recommendations',
    'subscriptions',
    'shorts',
    'channel',
    'playlist',
    'end-screen'
  ],
  linkedin: ['feed', 'reposts', 'promoted-posts', 'comment-preview'],
  x: ['following', 'for-you', 'replies', 'quoted-posts', 'threads'],
  reddit: ['home', 'popular', 'all', 'subreddit', 'search', 'comments'],
  'hacker-news': ['front-page', 'new', 'best', 'ask', 'show', 'jobs', 'item'],
  rss: ['feed-entry']
} as const satisfies Readonly<Record<Platform, readonly string[]>>

export const PLATFORM_SURFACE_VALUES = [
  'youtube:home',
  'youtube:search',
  'youtube:recommendations',
  'youtube:subscriptions',
  'youtube:shorts',
  'youtube:channel',
  'youtube:playlist',
  'youtube:end-screen',
  'linkedin:feed',
  'linkedin:reposts',
  'linkedin:promoted-posts',
  'linkedin:comment-preview',
  'x:following',
  'x:for-you',
  'x:replies',
  'x:quoted-posts',
  'x:threads',
  'reddit:home',
  'reddit:popular',
  'reddit:all',
  'reddit:subreddit',
  'reddit:search',
  'reddit:comments',
  'hacker-news:front-page',
  'hacker-news:new',
  'hacker-news:best',
  'hacker-news:ask',
  'hacker-news:show',
  'hacker-news:jobs',
  'hacker-news:item',
  'rss:feed-entry'
] as const

export const platformSurfaceSchema = z.enum(PLATFORM_SURFACE_VALUES)

export type PlatformSurface = z.infer<typeof platformSurfaceSchema>
