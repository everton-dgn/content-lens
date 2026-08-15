import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertRegularFile, parseArgs, stableJson } from './lib.mjs'

const UPLOAD_POLL_ATTEMPTS = 30
const UPLOAD_POLL_INTERVAL_MS = 10_000

const requireText = (value, name) => {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${name} is required.`)
  return value
}

const waitFor = milliseconds =>
  new Promise(done => {
    setTimeout(done, milliseconds)
  })

const requestJson = async (fetchImpl, url, options) => {
  const response = await fetchImpl(url, options)
  const body = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(
      `Chrome Web Store request failed with HTTP ${response.status}.`
    )
  return body
}

const awaitAsyncUpload = async ({
  fetchImpl,
  statusUrl,
  headers,
  waitImpl,
  pollAttempts,
  pollIntervalMs
}) => {
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    await waitImpl(pollIntervalMs)
    const status = await requestJson(fetchImpl, statusUrl, { headers })
    const state = status?.lastAsyncUploadState
    if (state === 'SUCCEEDED') return
    if (state === 'FAILED')
      throw new Error('Chrome Web Store rejected the uploaded package.')
    if (state !== 'IN_PROGRESS')
      throw new Error(
        `Chrome Web Store returned the unexpected upload state ${state ?? 'UNKNOWN'}.`
      )
  }
  throw new Error(
    `Chrome Web Store upload was still in progress after ${pollAttempts} status checks.`
  )
}

export const submitChromePackage = async ({
  publisherId,
  extensionId,
  zipPath,
  accessToken,
  fetchImpl = fetch,
  waitImpl = waitFor,
  pollAttempts = UPLOAD_POLL_ATTEMPTS,
  pollIntervalMs = UPLOAD_POLL_INTERVAL_MS
}) => {
  requireText(publisherId, 'Chrome publisher ID')
  requireText(extensionId, 'Chrome extension ID')
  requireText(accessToken, 'Chrome access token')
  requireText(zipPath, 'Chrome ZIP path')
  await assertRegularFile(zipPath)

  const name = `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}`
  const headers = {
    authorization: `Bearer ${accessToken}`,
    'x-goog-api-version': '2'
  }

  const statusUrl = `https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`

  await requestJson(fetchImpl, statusUrl, { headers })

  const upload = await requestJson(
    fetchImpl,
    `https://chromewebstore.googleapis.com/upload/v2/${name}:upload`,
    {
      method: 'POST',
      headers,
      body: await readFile(zipPath)
    }
  )
  if (upload?.uploadState === 'IN_PROGRESS')
    await awaitAsyncUpload({
      fetchImpl,
      statusUrl,
      headers,
      waitImpl,
      pollAttempts,
      pollIntervalMs
    })
  else if (upload?.uploadState !== 'SUCCEEDED')
    throw new Error('Chrome Web Store did not accept the uploaded package.')

  const publish = await requestJson(
    fetchImpl,
    `https://chromewebstore.googleapis.com/v2/${name}:publish`,
    {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        blockOnWarnings: true,
        publishType: 'STAGED_PUBLISH'
      })
    }
  )
  const warningCount = publish?.warningInfo?.warnings?.length ?? 0
  if (warningCount > 0)
    throw new Error(
      `Chrome Web Store blocked submission with ${warningCount} warning(s).`
    )

  return {
    extensionId,
    publisherId,
    publishType: 'STAGED_PUBLISH',
    status: 'submitted'
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = parseArgs(process.argv.slice(2))
  if (
    typeof args['publisher-id'] !== 'string' ||
    typeof args['extension-id'] !== 'string' ||
    typeof args.zip !== 'string'
  ) {
    throw new Error(
      'Usage: submit-chrome.mjs --publisher-id <id> --extension-id <id> --zip <path>'
    )
  }
  const result = await submitChromePackage({
    publisherId: args['publisher-id'],
    extensionId: args['extension-id'],
    zipPath: resolve(args.zip),
    accessToken: process.env.CWS_ACCESS_TOKEN
  })
  process.stdout.write(stableJson(result))
}
