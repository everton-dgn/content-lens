export const linkedInSelectors = {
  author: '[data-author-id]',
  candidate: 'article[data-urn], .feed-shared-update-v2[data-urn]',
  canonicalLink: 'a[href*="/feed/update/"], a[href*="/posts/"]',
  media: 'img[src]',
  text: '[data-contentlens-text], .update-components-text'
} as const
