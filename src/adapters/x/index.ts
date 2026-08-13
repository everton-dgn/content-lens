export {
  extractXCandidate,
  readXCandidateSource,
  xCandidateFingerprint
} from '@/adapters/x/extract'
export { xNativeFeedbackAddendum } from '@/adapters/x/native-feedback'
export { normalizeXCandidate } from '@/adapters/x/normalize'
export {
  detectXTimelineSurface,
  observeXCandidates
} from '@/adapters/x/observe'
export { matchXLocation } from '@/adapters/x/routes'
export {
  X_SURFACES,
  type XAuthorIdentity,
  type XCandidate,
  type XRelation,
  type XSurface
} from '@/adapters/x/types'

import { X_SURFACES } from '@/adapters/x/types'

export const xAdapterCapabilities = {
  fields: ['identity', 'author', 'body', 'media', 'relations', 'traits'],
  platform: 'x',
  surfaces: X_SURFACES
} as const
