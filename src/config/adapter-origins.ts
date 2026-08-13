export const INSTALLED_ADAPTER_ORIGINS = [
  {
    origin: 'https://www.youtube.com',
    platform: 'youtube'
  },
  {
    origin: 'https://www.linkedin.com',
    platform: 'linkedin'
  },
  {
    origin: 'https://x.com',
    platform: 'x'
  },
  {
    origin: 'https://www.reddit.com',
    platform: 'reddit'
  },
  {
    origin: 'https://news.ycombinator.com',
    platform: 'hacker-news'
  }
] as const

export const installedContentMatches = INSTALLED_ADAPTER_ORIGINS.map(
  ({ origin }) => `${origin}/*`
)

export const youtubeContentMatches = INSTALLED_ADAPTER_ORIGINS.filter(
  ({ platform }) => platform === 'youtube'
).map(({ origin }) => `${origin}/*`)
