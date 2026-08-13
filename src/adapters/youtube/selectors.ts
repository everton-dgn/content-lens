import type { YouTubeSurface } from '@/adapters/youtube/types'

export interface YouTubeSurfaceSelectors {
  candidate: string
  channelLink: string
  title: string
  videoLink: string
}

export const youtubeSelectors: Record<YouTubeSurface, YouTubeSurfaceSelectors> =
  {
    home: {
      candidate: 'ytd-rich-item-renderer',
      channelLink: 'ytd-channel-name a[href*="/channel/"]',
      title: '#video-title-link',
      videoLink: 'a#thumbnail[href], a#video-title-link[href]'
    },
    search: {
      candidate: 'ytd-video-renderer',
      channelLink: 'ytd-channel-name a[href*="/channel/"]',
      title: '#video-title',
      videoLink: 'a#thumbnail[href], a#video-title[href]'
    },
    recommendations: {
      candidate: 'ytd-compact-video-renderer, yt-lockup-view-model',
      channelLink: '#byline a[href*="/channel/"], a[href*="/channel/"]',
      title: '#video-title, h3',
      videoLink: 'a#thumbnail[href], a[href*="/watch"]'
    },
    subscriptions: {
      candidate: 'ytd-rich-item-renderer, ytd-grid-video-renderer',
      channelLink: 'ytd-channel-name a[href*="/channel/"]',
      title: '#video-title-link, #video-title',
      videoLink: 'a#thumbnail[href], a[href*="/watch"]'
    },
    shorts: {
      candidate: 'ytd-reel-item-renderer, ytd-rich-item-renderer[is-short]',
      channelLink: 'a[href*="/channel/"]',
      title: '#video-title, h3',
      videoLink: 'a[href*="/shorts/"]'
    },
    channel: {
      candidate:
        'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer',
      channelLink:
        'ytd-channel-name a[href*="/channel/"], a[href*="/channel/"]',
      title: '#video-title-link, #video-title',
      videoLink: 'a#thumbnail[href], a[href*="/watch"]'
    },
    playlist: {
      candidate: 'ytd-playlist-video-renderer',
      channelLink:
        'ytd-channel-name a[href*="/channel/"], a[href*="/channel/"]',
      title: '#video-title',
      videoLink: 'a#thumbnail[href], a[href*="/watch"]'
    },
    'end-screen': {
      candidate: '.ytp-ce-video, .ytp-ce-covering-overlay',
      channelLink: 'a[href*="/channel/"]',
      title: '.ytp-ce-video-title, h3',
      videoLink: 'a[href*="/watch"]'
    }
  }
