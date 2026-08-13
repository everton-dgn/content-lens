import {
  AdapterOriginMap,
  type AdapterOriginOwnership
} from '@/adapters/registry/origins'
import {
  INSTALLED_ADAPTER_ORIGINS,
  installedContentMatches,
  youtubeContentMatches
} from '@/config/adapter-origins'

export const installedAdapterOriginMap = new AdapterOriginMap(
  INSTALLED_ADAPTER_ORIGINS satisfies readonly AdapterOriginOwnership[]
)

export {
  INSTALLED_ADAPTER_ORIGINS,
  installedContentMatches,
  youtubeContentMatches
}
