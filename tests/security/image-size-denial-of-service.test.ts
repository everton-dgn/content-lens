import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

const projectRequire = createRequire(import.meta.url)
const requireFromWebExt = createRequire(projectRequire.resolve('web-ext'))
const requireFromAddonsLinter = createRequire(
  requireFromWebExt.resolve('addons-linter')
)
const imageSizeEntry = requireFromAddonsLinter.resolve('image-size')
const imageSizeEsmEntry = imageSizeEntry.replace(/index\.cjs$/, 'index.mjs')

const runtimes = [
  {
    loadImageSize: `const { imageSize } = require(${JSON.stringify(imageSizeEntry)})`,
    nodeArguments: [],
    runtime: 'CommonJS'
  },
  {
    loadImageSize: `import { imageSize } from ${JSON.stringify(pathToFileURL(imageSizeEsmEntry).href)}`,
    nodeArguments: ['--input-type=module'],
    runtime: 'ESM'
  }
] as const

const runImageSize = (
  loadImageSize: string,
  nodeArguments: readonly string[],
  body: string
) =>
  spawnSync(
    process.execPath,
    [...nodeArguments, '-e', `${loadImageSize}; ${body}`],
    {
      encoding: 'utf8',
      timeout: 1_000
    }
  )

const malformedCases = [
  {
    format: 'ICNS',
    expectedError: 'Invalid ICNS, zero-length entry',
    input: `
      const input = Buffer.alloc(16)
      input.write('icns', 0)
      input.writeUInt32BE(16, 4)
      input.write('ic07', 8)
      input.writeUInt32BE(0, 12)
    `
  },
  {
    format: 'HEIF',
    expectedError: 'Invalid HEIF, zero-length ispe box',
    input: `
      const input = Buffer.alloc(60)
      input.writeUInt32BE(12, 0)
      input.write('ftyp', 4)
      input.write('avif', 8)
      input.writeUInt32BE(48, 12)
      input.write('meta', 16)
      input.writeUInt32BE(36, 24)
      input.write('iprp', 28)
      input.writeUInt32BE(28, 32)
      input.write('ipco', 36)
      input.writeUInt32BE(0, 40)
      input.write('ispe', 44)
      input.writeUInt32BE(1, 52)
      input.writeUInt32BE(1, 56)
    `
  },
  {
    format: 'JXL',
    expectedError: 'Invalid JXL, zero-length jxlp box',
    input: `
      const input = Buffer.alloc(36)
      input.writeUInt32BE(12, 0)
      input.write('JXL ', 4)
      input.writeUInt32BE(12, 12)
      input.write('ftyp', 16)
      input.write('jxl ', 20)
      input.writeUInt32BE(0, 24)
      input.write('jxlp', 28)
    `
  }
] as const

const validCases = [
  {
    format: 'ICNS',
    expected: { height: 128, type: 'icns', width: 128 },
    input: `
      const input = Buffer.alloc(16)
      input.write('icns', 0)
      input.writeUInt32BE(16, 4)
      input.write('ic07', 8)
      input.writeUInt32BE(8, 12)
    `
  },
  {
    format: 'HEIF',
    expected: { height: 1, type: 'avif', width: 1 },
    input: `
      const input = Buffer.alloc(60)
      input.writeUInt32BE(12, 0)
      input.write('ftyp', 4)
      input.write('avif', 8)
      input.writeUInt32BE(48, 12)
      input.write('meta', 16)
      input.writeUInt32BE(36, 24)
      input.write('iprp', 28)
      input.writeUInt32BE(28, 32)
      input.write('ipco', 36)
      input.writeUInt32BE(20, 40)
      input.write('ispe', 44)
      input.writeUInt32BE(1, 52)
      input.writeUInt32BE(1, 56)
    `
  },
  {
    format: 'JXL',
    expected: { height: 8, type: 'jxl', width: 8 },
    input: `
      const input = Buffer.alloc(36)
      input.writeUInt32BE(12, 0)
      input.write('JXL ', 4)
      input.writeUInt32BE(12, 12)
      input.write('ftyp', 16)
      input.write('jxl ', 20)
      input.writeUInt32BE(12, 24)
      input.write('jxlc', 28)
      input[32] = 0xff
      input[33] = 0x0a
      input[34] = 0x01
    `
  }
] as const

describe.each(runtimes)(
  'image-size transitive denial-of-service patch ($runtime)',
  ({ loadImageSize, nodeArguments }) => {
    it.each(malformedCases)(
      'rejects a zero-length $format entry without hanging',
      ({ expectedError, input }) => {
        const result = runImageSize(
          loadImageSize,
          nodeArguments,
          `
          ${input}
          try {
            imageSize(input)
            throw new Error('Expected the malformed image to be rejected')
          } catch (error) {
            if (!(error instanceof TypeError) || error.message !== ${JSON.stringify(expectedError)}) {
              throw error
            }
          }
        `
        )

        expect(result.error).toBeUndefined()
        expect(result.signal).toBeNull()
        expect(result.status).toBe(0)
        expect(result.stderr).toBe('')
      }
    )

    it.each(validCases)(
      'preserves valid $format dimensions',
      ({ expected, input }) => {
        const result = runImageSize(
          loadImageSize,
          nodeArguments,
          `
          ${input}
          process.stdout.write(JSON.stringify(imageSize(input)))
        `
        )

        expect(result.error).toBeUndefined()
        expect(result.signal).toBeNull()
        expect(result.status).toBe(0)
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toEqual(expected)
      }
    )
  }
)
