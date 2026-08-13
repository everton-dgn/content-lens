import {
  type NativeFeedbackAddendum,
  unavailableCapability
} from '@/application/native-feedback/addendum'
import { PLATFORM_SURFACES } from '@/core/content/surfaces'

export const hackerNewsNativeFeedbackAddendum: NativeFeedbackAddendum = {
  platform: 'hacker-news',
  adapterVersion: 'hacker-news-adapter@1',
  addendumVersion: 'hacker-news-native-feedback@1',
  fixtureVersion: 'hacker-news-fixtures@1',
  lastLiveSmokeAt: null,
  capabilities: PLATFORM_SURFACES['hacker-news'].map(surface =>
    unavailableCapability({
      platform: 'hacker-news',
      surface: `hacker-news:${surface}`,
      adapterVersion: 'hacker-news-adapter@1',
      addendumVersion: 'hacker-news-native-feedback@1',
      fixtureVersion: 'hacker-news-fixtures@1',
      code: 'native-feedback-unavailable'
    })
  ),
  prohibitedActions: ['upvote', 'flag', 'hide', 'reply']
}
