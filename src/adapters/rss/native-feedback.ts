import {
  type NativeFeedbackAddendum,
  unavailableCapability
} from '@/application/native-feedback/addendum'

export const rssNativeFeedbackAddendum: NativeFeedbackAddendum = {
  platform: 'rss',
  adapterVersion: 'rss-adapter@1',
  addendumVersion: 'rss-native-feedback@1',
  fixtureVersion: 'rss-fixtures@1',
  lastLiveSmokeAt: null,
  capabilities: [
    unavailableCapability({
      platform: 'rss',
      surface: 'rss:feed-entry',
      adapterVersion: 'rss-adapter@1',
      addendumVersion: 'rss-native-feedback@1',
      fixtureVersion: 'rss-fixtures@1',
      code: 'native-feedback-unavailable'
    })
  ],
  prohibitedActions: ['unsubscribe', 'delete-feed', 'mark-read']
}
