import { createHmac, createSign, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { parseArgs, stableJson } from './lib.mjs'

const encode = value => Buffer.from(value).toString('base64url')

export const createAmoJwt = ({
  issuer,
  keyMaterial,
  now = Math.floor(Date.now() / 1000)
}) => {
  const header = encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = encode(
    JSON.stringify({
      iss: issuer,
      jti: randomUUID(),
      iat: now,
      exp: now + 300
    })
  )
  const input = `${header}.${payload}`
  return `${input}.${createHmac('sha256', keyMaterial).update(input).digest('base64url')}`
}

export const createGoogleAssertion = ({
  email,
  privateKey,
  now = Math.floor(Date.now() / 1000)
}) => {
  const header = encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = encode(
    JSON.stringify({
      iss: email,
      scope: 'https://www.googleapis.com/auth/chromewebstore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    })
  )
  const input = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')
  signer.update(input)
  signer.end()
  return `${input}.${signer.sign(privateKey, 'base64url')}`
}

const fetchJson = async (url, options) => {
  const response = await fetch(url, options)
  const body = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(`Store status request failed with HTTP ${response.status}.`)
  return body
}

const googleAccessToken = async ({ email, privateKey }) => {
  const assertion = createGoogleAssertion({ email, privateKey })
  const response = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  })
  if (typeof response?.access_token !== 'string')
    throw new Error('Google token response omitted access_token.')
  return response.access_token
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

const fetchChromeStatus = async ({
  publisherId,
  itemId,
  email,
  privateKey
}) => {
  const accessToken = await googleAccessToken({ email, privateKey })
  return fetchJson(
    `https://chromewebstore.googleapis.com/v2/publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(itemId)}:fetchStatus`,
    { headers: { authorization: `Bearer ${accessToken}` } }
  )
}

const fetchAmoStatus = async ({ extensionId, jwt }) => {
  const pages = []
  const initial = new URL(
    `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(extensionId)}/versions/`
  )
  initial.searchParams.set('filter', 'all_without_unlisted')
  initial.searchParams.set('page_size', '50')
  let url = initial.toString()
  while (url) {
    const page = await fetchJson(url, {
      headers: { authorization: `JWT ${jwt}` }
    })
    pages.push(page)
    url = typeof page?.next === 'string' ? page.next : ''
    if (pages.length > 20)
      throw new Error('AMO status pagination exceeded 20 pages.')
  }
  return { pages }
}

export const queryStoreStatus = async ({
  store,
  version,
  dryResponse,
  env = process.env
}) => {
  const response = dryResponse
    ? JSON.parse(await readFile(dryResponse, 'utf8'))
    : store === 'chrome'
      ? await fetchChromeStatus({
          publisherId: env.CWS_PUBLISHER_ID,
          itemId: env.CWS_EXTENSION_ID,
          email: env.CWS_SERVICE_ACCOUNT_EMAIL,
          privateKey: env.CWS_SERVICE_ACCOUNT_PRIVATE_KEY?.replaceAll(
            '\\n',
            '\n'
          )
        })
      : await fetchAmoStatus({
          extensionId: env.AMO_EXTENSION_ID,
          jwt:
            env.AMO_JWT ||
            createAmoJwt({
              issuer: env.AMO_JWT_ISSUER,
              keyMaterial: env.AMO_JWT_SECRET
            })
        })
  return decideStoreStatus({ store, version, response })
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = parseArgs(process.argv.slice(2))
  if (
    (args.store !== 'chrome' && args.store !== 'amo') ||
    typeof args.version !== 'string'
  ) {
    throw new Error(
      'Usage: store-status.mjs --store chrome|amo --version <version> [--dry-response <json>]'
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
