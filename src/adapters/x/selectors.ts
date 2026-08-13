export const xSelectors = {
  author: '[data-contentlens-author-id]',
  authorDisplay: '[data-testid="User-Name"] span',
  authorProfile: '[data-testid="User-Name"] a[href^="/"]',
  candidate: 'article[data-testid="tweet"]',
  canonicalLink: 'a[href*="/status/"]',
  image: '[data-testid="tweetPhoto"] img[src]',
  text: '[data-testid="tweetText"]',
  video: 'video[poster]'
} as const
