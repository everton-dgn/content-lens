import { fingerprintPortableValue } from '@/core/operations/fingerprint'
import {
  type ContentSimilarityRelation,
  contentSimilarityRelationSchema,
  type RepresentationManifest
} from '@/core/similarity/contracts'

export const DEFAULT_RELATION_THRESHOLDS = Object.freeze({
  nearDuplicate: 0.96,
  semanticallySimilar: 0.82,
  relatedDistinct: 0.65,
  storyUpdate: 0.84
})

export type RelationEvidence = {
  structuralOverlap: boolean
  visualAgreement: boolean
  materialFactDelta: boolean
  publishedTimeDelta: boolean
  sourceLink: boolean
}

type RelationInput = {
  leftContentId: string
  rightContentId: string
  score: number
  confidence: number
  representation: RepresentationManifest
  evidence: RelationEvidence
  evidenceVersion: string
  relationPolicyVersion: string
  createdAt: string
  validUntil: string
  thresholds?: Partial<typeof DEFAULT_RELATION_THRESHOLDS>
}

export type SimilarityEvidenceCode =
  | 'text-vector'
  | 'visual-vector'
  | 'structural-overlap'
  | 'published-time-delta'
  | 'material-fact-delta'
  | 'source-link'

function evidenceCodes(input: RelationInput): SimilarityEvidenceCode[] {
  const codes: SimilarityEvidenceCode[] =
    input.representation.modality === 'visual'
      ? ['visual-vector']
      : ['text-vector']
  if (input.evidence.structuralOverlap) {
    codes.push('structural-overlap')
  }
  if (input.evidence.publishedTimeDelta) {
    codes.push('published-time-delta')
  }
  if (input.evidence.materialFactDelta) {
    codes.push('material-fact-delta')
  }
  if (input.evidence.sourceLink) {
    codes.push('source-link')
  }
  return codes
}

export async function classifySimilarityRelation(
  input: RelationInput
): Promise<
  | { state: 'related'; relation: ContentSimilarityRelation }
  | { state: 'separate'; code: 'low-score' | 'incompatible-version-space' }
> {
  const parsedManifest = input.representation
  if (!parsedManifest.versionSpace || parsedManifest.dimension < 1) {
    return { state: 'separate', code: 'incompatible-version-space' }
  }
  const thresholds = { ...DEFAULT_RELATION_THRESHOLDS, ...input.thresholds }
  let type: ContentSimilarityRelation['type']
  let threshold: number
  if (
    input.score >= thresholds.nearDuplicate &&
    (input.evidence.structuralOverlap || input.evidence.visualAgreement) &&
    !input.evidence.materialFactDelta
  ) {
    type = 'near-duplicate'
    threshold = thresholds.nearDuplicate
  } else if (
    input.score >= thresholds.storyUpdate &&
    input.evidence.materialFactDelta &&
    input.evidence.publishedTimeDelta
  ) {
    type = 'story-update'
    threshold = thresholds.storyUpdate
  } else if (input.score >= thresholds.semanticallySimilar) {
    type = 'semantically-similar'
    threshold = thresholds.semanticallySimilar
  } else if (input.score >= thresholds.relatedDistinct) {
    type = 'related-distinct'
    threshold = thresholds.relatedDistinct
  } else {
    return { state: 'separate', code: 'low-score' }
  }
  const evidence = evidenceCodes(input)
  const relationId = `relation:${await fingerprintPortableValue({
    left: input.leftContentId,
    right: input.rightContentId,
    type,
    evidenceVersion: input.evidenceVersion,
    versionSpace: input.representation.versionSpace
  })}`
  return {
    state: 'related',
    relation: contentSimilarityRelationSchema.parse({
      relationId,
      leftContentId: input.leftContentId,
      rightContentId: input.rightContentId,
      type,
      score: input.score,
      confidence: input.confidence,
      threshold,
      evidenceCodes: evidence satisfies SimilarityEvidenceCode[],
      evidenceVersion: input.evidenceVersion,
      representation: input.representation,
      relationPolicyVersion: input.relationPolicyVersion,
      advisoryOnly:
        input.confidence < 0.9 ||
        type === 'semantically-similar' ||
        type === 'related-distinct' ||
        type === 'story-update',
      createdAt: input.createdAt,
      validUntil: input.validUntil
    })
  }
}

export function representationSpacesCompatible(
  left: RepresentationManifest,
  right: RepresentationManifest
) {
  return (
    left.versionSpace === right.versionSpace &&
    left.dimension === right.dimension &&
    left.modality === right.modality &&
    left.normalization === right.normalization &&
    left.preprocessingVersion === right.preprocessingVersion &&
    left.modelProviderId === right.modelProviderId &&
    left.modelId === right.modelId
  )
}
