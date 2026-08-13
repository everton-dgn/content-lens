export {
  extractLinkedInCandidate,
  linkedInCandidateFingerprint,
  readLinkedInCandidateSource
} from '@/adapters/linkedin/extract'
export { linkedinNativeFeedbackAddendum } from '@/adapters/linkedin/native-feedback'
export { normalizeLinkedInCandidate } from '@/adapters/linkedin/normalize'
export { observeLinkedInCandidates } from '@/adapters/linkedin/observe'
export { matchLinkedInLocation } from '@/adapters/linkedin/routes'
export {
  LINKEDIN_SURFACES,
  type LinkedInAuthorIdentity,
  type LinkedInCandidate,
  type LinkedInObservationError,
  type LinkedInSurface
} from '@/adapters/linkedin/types'

import { LINKEDIN_SURFACES } from '@/adapters/linkedin/types'

export const linkedInAdapterCapabilities = {
  fields: ['identity', 'author', 'body', 'media', 'relations', 'traits'],
  platform: 'linkedin',
  surfaces: LINKEDIN_SURFACES
} as const
