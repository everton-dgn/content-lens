import {
  type NativeFeedbackAddendum,
  unavailableCapability
} from '@/application/native-feedback/addendum'
import { PLATFORM_SURFACES } from '@/core/content/surfaces'

const adapterVersion = 'youtube-adapter@1'
const addendumVersion = 'youtube-native-feedback@1'
const fixtureVersion = 'youtube-fixtures@1'

export const youtubeNativeFeedbackAddendum: NativeFeedbackAddendum = {
  platform: 'youtube',
  adapterVersion,
  addendumVersion,
  fixtureVersion,
  lastLiveSmokeAt: null,
  capabilities: PLATFORM_SURFACES.youtube.flatMap(surface =>
    (
      ['youtube:not-interested', 'youtube:do-not-recommend-channel'] as const
    ).map(actionType =>
      unavailableCapability({
        platform: 'youtube',
        surface: `youtube:${surface}`,
        actionType,
        adapterVersion,
        addendumVersion,
        fixtureVersion,
        code: 'live-menu-and-confirmation-not-verified'
      })
    )
  ),
  prohibitedActions: [
    'subscribe',
    'unsubscribe',
    'like',
    'dislike',
    'report',
    'block'
  ]
}
