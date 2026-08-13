import { hackerNewsNativeFeedbackAddendum } from '@/adapters/hacker-news/native-feedback'
import { linkedinNativeFeedbackAddendum } from '@/adapters/linkedin/native-feedback'
import { redditNativeFeedbackAddendum } from '@/adapters/reddit/native-feedback'
import { rssNativeFeedbackAddendum } from '@/adapters/rss/native-feedback'
import { xNativeFeedbackAddendum } from '@/adapters/x/native-feedback'
import { youtubeNativeFeedbackAddendum } from '@/adapters/youtube/native-feedback'
import {
  findAddendumCapability,
  type NativeFeedbackAddendum
} from '@/application/native-feedback/addendum'
import type { Platform } from '@/core/content/contracts'
import type { NativeFeedbackAction } from '@/core/feedback/native-contracts'

export const nativeFeedbackAddenda = {
  youtube: youtubeNativeFeedbackAddendum,
  linkedin: linkedinNativeFeedbackAddendum,
  x: xNativeFeedbackAddendum,
  reddit: redditNativeFeedbackAddendum,
  'hacker-news': hackerNewsNativeFeedbackAddendum,
  rss: rssNativeFeedbackAddendum
} as const satisfies Record<Platform, NativeFeedbackAddendum>

export function nativeFeedbackCapability(
  platform: Platform,
  surface: string,
  actionType: NativeFeedbackAction
) {
  return findAddendumCapability(
    nativeFeedbackAddenda[platform],
    surface,
    actionType
  )
}
