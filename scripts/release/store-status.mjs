import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { parseArgs, stableJson } from './lib.mjs'

const requireText = (value, name) => {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${name} is required.`)
  return value
}

const fetchJson = async (url, options) => {
  const response = await fetch(url, options)
  const body = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(`Store status request failed with HTTP ${response.status}.`)
  return body
}

const collectState = (
  value,
  key = '',
  state = { versions: new Set(), statuses: [], hazards: [] }
) => {
  if (Array.isArray(value)) {
    for (const item of value) collectState(item, key, state)
    return state
  }
  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value))
      collectState(childValue, childKey, state)
    return state
  }
  if (typeof value !== 'string') return state
  if (
    /version/iu.test(key) &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value)
  )
    state.versions.add(value)
  if (/status|state/iu.test(key)) state.statuses.push(value)
  if (/warning|error|rejection|conflict/iu.test(key) && value.trim() !== '')
    state.hazards.push(`${key}:${value}`)
  return state
}

export const decideStoreStatus = ({ store, version, response }) => {
  const state = collectState(response)
  const blockedStatuses = state.statuses.filter(status =>
    /reject|warn|fail|error|conflict|blocked|disabled/iu.test(status)
  )
  if (state.hazards.length > 0 || blockedStatuses.length > 0) {
    return {
      store,
      version,
      decision: 'blocked',
      versions: [...state.versions].sort(),
      statuses: state.statuses,
      reasons: [...state.hazards, ...blockedStatuses]
    }
  }
  if (state.versions.has(version)) {
    return {
      store,
      version,
      decision: 'already-present',
      versions: [...state.versions].sort(),
      statuses: state.statuses,
      reasons: []
    }
  }
  return {
    store,
    version,
    decision: 'eligible',
    versions: [...state.versions].sort(),
    statuses: state.statuses,
    reasons: []
  }
}

const fetchChromeStatus = async ({ publisherId, itemId, accessToken }) => {
  requireText(publisherId, 'Chrome publisher ID')
  requireText(itemId, 'Chrome extension ID')
  requireText(accessToken, 'Chrome access token')
  return fetchJson(
    `https://chromewebstore.googleapis.com/v2/publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(itemId)}:fetchStatus`,
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-goog-api-version': '2'
      }
    }
  )
}

export const queryStoreStatus = async ({
  store,
  version,
  dryResponse,
  env = process.env
}) => {
  const response = dryResponse
    ? JSON.parse(await readFile(dryResponse, 'utf8'))
    : await fetchChromeStatus({
        publisherId: env.CWS_PUBLISHER_ID,
        itemId: env.CWS_EXTENSION_ID,
        accessToken: env.CWS_ACCESS_TOKEN
      })
  return decideStoreStatus({ store, version, response })
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = parseArgs(process.argv.slice(2))
  if (args.store !== 'chrome' || typeof args.version !== 'string') {
    throw new Error(
      'Usage: store-status.mjs --store chrome --version <version> [--dry-response <json>]'
    )
  }
  const result = await queryStoreStatus({
    store: args.store,
    version: args.version,
    dryResponse:
      typeof args['dry-response'] === 'string'
        ? resolve(args['dry-response'])
        : ''
  })
  process.stdout.write(stableJson(result))
  if (result.decision === 'blocked') process.exitCode = 2
}
