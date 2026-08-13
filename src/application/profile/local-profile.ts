import {
  type ProfileEnvelope,
  profileEnvelopeSchema
} from '@/storage/contracts/profile-envelope'

export type CreateLocalProfileInput = {
  at: string
  profileId: string
}

export function createLocalProfile(
  input: CreateLocalProfileInput
): ProfileEnvelope {
  return profileEnvelopeSchema.parse({
    schemaVersion: { major: 1, minor: 0 },
    profileId: input.profileId,
    revision: 0,
    createdAt: input.at,
    updatedAt: input.at,
    rules: [],
    feedbackExamples: [],
    settings: {
      enabledPlatforms: ['youtube']
    }
  })
}
