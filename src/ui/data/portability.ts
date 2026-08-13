import {
  type ProfileEnvelope,
  profileEnvelopeSchema
} from '@/storage/contracts/profile-envelope'

export function serializePortableProfile(profile: ProfileEnvelope) {
  return `${JSON.stringify(profileEnvelopeSchema.parse(profile), null, 2)}\n`
}

export function serializeDiagnosticExport(input: unknown) {
  return `${JSON.stringify(input, null, 2)}\n`
}

type DownloadEnvironment = {
  document: Document
  urls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
}

export function downloadJson(
  content: string,
  filename: string,
  environment: DownloadEnvironment = {
    document,
    urls: URL
  }
) {
  const blob = new Blob([content], { type: 'application/json' })
  const objectUrl = environment.urls.createObjectURL(blob)
  const anchor = environment.document.createElement('a')
  anchor.download = filename
  anchor.href = objectUrl
  anchor.rel = 'noopener'
  anchor.click()
  queueMicrotask(() => {
    environment.urls.revokeObjectURL(objectUrl)
  })
}
