import {
  type NativeFeedbackAddendum,
  unavailableCapability
} from '@/application/native-feedback/addendum'
import { PLATFORM_SURFACES } from '@/core/content/surfaces'

const adapterVersion = 'reddit-adapter@1'
const addendumVersion = 'reddit-native-feedback@1'
const fixtureVersion = 'reddit-fixtures@1'

export const redditNativeFeedbackAddendum: NativeFeedbackAddendum = {
  platform: 'reddit',
  adapterVersion,
  addendumVersion,
  fixtureVersion,
  lastLiveSmokeAt: null,
  capabilities: PLATFORM_SURFACES.reddit.map(surface =>
    unavailableCapability({
      platform: 'reddit',
      surface: `reddit:${surface}`,
      actionType: 'reddit:show-less-similar',
      adapterVersion,
      addendumVersion,
      fixtureVersion,
      code: 'live-control-and-confirmation-not-verified'
    })
  ),
  prohibitedActions: [
    'vote',
    'award',
    'join',
    'leave',
    'block',
    'comment',
    'report'
  ]
}
