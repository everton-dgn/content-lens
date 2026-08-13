import {
  comparePortableStrings,
  fingerprintPortableValue
} from '@/core/operations/fingerprint'
import {
  type SimilarityCluster,
  type SimilarityClusterMember,
  similarityClusterSchema
} from '@/core/similarity/contracts'

function representativeOrder(
  left: SimilarityClusterMember,
  right: SimilarityClusterMember
) {
  if (left.stableIdentity !== right.stableIdentity) {
    return left.stableIdentity ? -1 : 1
  }
  if (left.sponsored !== right.sponsored) {
    return left.sponsored ? 1 : -1
  }
  if (left.sourceEvidence !== right.sourceEvidence) {
    return left.sourceEvidence ? -1 : 1
  }
  const leftPublished = left.publishedAt ?? '9999-12-31T23:59:59.999Z'
  const rightPublished = right.publishedAt ?? '9999-12-31T23:59:59.999Z'
  const byPublished = comparePortableStrings(leftPublished, rightPublished)
  return byPublished === 0
    ? comparePortableStrings(left.portableOrderId, right.portableOrderId)
    : byPublished
}

export function chooseClusterRepresentative(
  members: readonly SimilarityClusterMember[]
) {
  return [...members].sort(representativeOrder)[0]
}

export async function createSimilarityCluster(input: {
  members: readonly SimilarityClusterMember[]
  evidenceVersion: string
  createdAt: string
  updatedAt?: string
}): Promise<SimilarityCluster> {
  const representative = chooseClusterRepresentative(input.members)
  if (!representative) {
    throw new TypeError('A similarity cluster requires members')
  }
  const memberIds = input.members
    .map(member => member.contentId)
    .sort(comparePortableStrings)
  return similarityClusterSchema.parse({
    clusterId: `cluster:${await fingerprintPortableValue({
      memberIds,
      evidenceVersion: input.evidenceVersion
    })}`,
    representativeContentId: representative.contentId,
    members: structuredClone(input.members),
    evidenceVersion: input.evidenceVersion,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt
  })
}

export function clusterReviewSummary(cluster: SimilarityCluster) {
  return {
    total: cluster.members.length,
    representativeContentId: cluster.representativeContentId,
    protectedCount: cluster.members.filter(member => member.protected).length,
    updateCount: cluster.members.filter(member => member.update).length,
    sponsoredCount: cluster.members.filter(member => member.sponsored).length,
    relationCounts: Object.fromEntries(
      [
        'exact-duplicate',
        'near-duplicate',
        'semantically-similar',
        'story-update',
        'related-distinct'
      ].map(type => [
        type,
        cluster.members.filter(member => member.relationType === type).length
      ])
    )
  }
}
