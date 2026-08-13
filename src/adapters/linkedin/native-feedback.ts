import {
  type NativeFeedbackAddendum,
  unavailableCapability
} from '@/application/native-feedback/addendum'
import { PLATFORM_SURFACES } from '@/core/content/surfaces'

const adapterVersion = 'linkedin-adapter@1'
const addendumVersion = 'linkedin-native-feedback@1'
const fixtureVersion = 'linkedin-fixtures@1'

export const linkedinNativeFeedbackAddendum: NativeFeedbackAddendum = {
  platform: 'linkedin',
  adapterVersion,
  addendumVersion,
  fixtureVersion,
  lastLiveSmokeAt: null,
  capabilities: PLATFORM_SURFACES.linkedin.map(surface =>
    unavailableCapability({
      platform: 'linkedin',
      surface: `linkedin:${surface}`,
      actionType: 'linkedin:reduce-similar',
      adapterVersion,
      addendumVersion,
      fixtureVersion,
      code: 'live-control-and-confirmation-not-verified'
    })
  ),
  prohibitedActions: [
    'unfollow',
    'connect',
    'disconnect',
    'endorse',
    'react',
    'report'
  ]
}
