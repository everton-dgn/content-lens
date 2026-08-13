import { readdir, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_CHUNK_LIMIT_BYTES = 500_000

export interface BundleChunk {
  bytes: number
  path: string
}

const collectJavaScriptChunks = async (
  directory: string,
  root = directory
): Promise<BundleChunk[]> => {
  const chunks: BundleChunk[] = []

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      chunks.push(...(await collectJavaScriptChunks(path, root)))
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      chunks.push({
        bytes: (await stat(path)).size,
        path: relative(root, path)
      })
    }
  }

  return chunks.sort((left, right) => left.path.localeCompare(right.path))
}

export const findOversizedChunks = (
  chunks: readonly BundleChunk[],
  limitBytes = DEFAULT_CHUNK_LIMIT_BYTES
) => chunks.filter(({ bytes }) => bytes > limitBytes)

export const guardBundleDirectory = async (
  directory: string,
  limitBytes = DEFAULT_CHUNK_LIMIT_BYTES
) => {
  const chunks = await collectJavaScriptChunks(directory)
  if (chunks.length === 0) {
    throw new Error(`No JavaScript chunks found in ${directory}.`)
  }

  const oversized = findOversizedChunks(chunks, limitBytes)
  if (oversized.length > 0) {
    throw new Error(
      `Bundle chunk limit exceeded (${limitBytes} bytes): ${oversized
        .map(({ bytes, path }) => `${path} (${bytes} bytes)`)
        .join(', ')}.`
    )
  }

  const largest = chunks.reduce((current, chunk) =>
    chunk.bytes > current.bytes ? chunk : current
  )
  return { chunks: chunks.length, largest }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isEntrypoint) {
  const directory = process.argv[2]
  if (!directory) {
    throw new Error('Usage: bundle-size-guard.ts <bundle-directory>')
  }
  const result = await guardBundleDirectory(resolve(directory))
  console.log(
    `Bundle guard passed: ${result.chunks} JavaScript files; largest ${result.largest.path} (${result.largest.bytes} bytes).`
  )
}
