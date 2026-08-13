import {
  type NativeFeedbackAddendum,
  unavailableCapability
} from '@/application/native-feedback/addendum'
import { PLATFORM_SURFACES } from '@/core/content/surfaces'

const adapterVersion = 'x-adapter@1'
const addendumVersion = 'x-native-feedback@1'
const fixtureVersion = 'x-fixtures@1'

export const xNativeFeedbackAddendum: NativeFeedbackAddendum = {
  platform: 'x',
  adapterVersion,
  addendumVersion,
  fixtureVersion,
  lastLiveSmokeAt: null,
  capabilities: PLATFORM_SURFACES.x.map(surface =>
    unavailableCapability({
      platform: 'x',
      surface: `x:${surface}`,
      actionType: 'x:not-interested-post',
      adapterVersion,
      addendumVersion,
      fixtureVersion,
      code: 'live-menu-and-confirmation-not-verified'
    })
  ),
  prohibitedActions: [
    'mute',
    'block',
    'follow',
    'unfollow',
    'like',
    'repost',
    'report'
  ]
}
