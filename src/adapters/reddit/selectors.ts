import type { RedditSurface } from '@/adapters/reddit/types'

const postCandidates = '[data-testid="post-container"], shreddit-post'
const commentCandidates = '[data-testid="comment"], shreddit-comment'

export const redditCandidateSelector = (surface: RedditSurface): string =>
  surface === 'comments' ? commentCandidates : postCandidates

export const redditSelectors = {
  author: '[data-contentlens-author-id]',
  body: "[data-contentlens-body], shreddit-post-text-body, [slot='comment'], [slot='comment-body']",
  candidate: `${postCandidates}, ${commentCandidates}`,
  canonicalLink:
    'a[data-contentlens-canonical][href*="/comments/"], a[href*="/comments/"]',
  image:
    "img[data-contentlens-media][src], [slot='post-media-container'] img[src]",
  subreddit: '[data-contentlens-subreddit-id]',
  title: "[data-contentlens-title], [slot='title']",
  video: 'video[data-contentlens-media][poster]'
} as const
