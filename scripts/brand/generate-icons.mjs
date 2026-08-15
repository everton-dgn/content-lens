import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createBrandIconSvg } from '../../src/ui/brand/mark.ts'

const iconSizes = [16, 20, 24, 32, 48, 64, 128]
const root = resolve(import.meta.dirname, '../..')
const iconDirectory = resolve(root, 'public/icon')
const generatedManifestPath = resolve(
  import.meta.dirname,
  'icons.generated.json'
)

const sha256 = value => createHash('sha256').update(value).digest('hex')

const readPngDimensions = buffer => {
  const pngSignature = '89504e470d0a1a0a'

  if (
    buffer.length < 24 ||
    buffer.subarray(0, 8).toString('hex') !== pngSignature ||
    buffer.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    throw new Error('Generated icon is not a valid PNG with an IHDR header.')
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  }
}

const iconPath = size => resolve(iconDirectory, `${size}.png`)

const buildGeneratedManifest = async svg => {
  const icons = {}

  for (const size of iconSizes) {
    const buffer = await readFile(iconPath(size))
    const dimensions = readPngDimensions(buffer)

    if (dimensions.width !== size || dimensions.height !== size) {
      throw new Error(
        `public/icon/${size}.png is ${dimensions.width}x${dimensions.height}; expected ${size}x${size}.`
      )
    }

    icons[size] = {
      path: `public/icon/${size}.png`,
      sha256: sha256(buffer)
    }
  }

  return {
    schemaVersion: 1,
    generator: 'scripts/brand/generate-icons.mjs',
    source: 'src/ui/brand/mark.ts',
    sourceSha256: sha256(svg),
    icons
  }
}

const generateIcons = async svg => {
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch({ headless: true })
  const renderedIcons = new Map()

  try {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: 128, height: 128 }
    })

    await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body, svg { display: block; height: 100%; margin: 0; width: 100%; }
      body { overflow: hidden; }
    </style>
  </head>
  <body>${svg}</body>
</html>`)

    for (const size of iconSizes) {
      await page.setViewportSize({ width: size, height: size })
      renderedIcons.set(
        size,
        await page.screenshot({
          animations: 'disabled',
          caret: 'hide',
          fullPage: false,
          omitBackground: true,
          type: 'png'
        })
      )
    }
  } finally {
    await browser.close()
  }

  for (const [size, buffer] of renderedIcons) {
    await writeFile(iconPath(size), buffer)
  }

  const manifest = await buildGeneratedManifest(svg)
  await writeFile(
    generatedManifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`
  )

  console.log(`Generated ${iconSizes.length} canonical ContentLens icons.`)
}

const checkIcons = async svg => {
  const recorded = JSON.parse(await readFile(generatedManifestPath, 'utf8'))
  const current = await buildGeneratedManifest(svg)
  const expectedSizes = iconSizes.map(String)
  const recordedSizes = Object.keys(recorded.icons ?? {})
  const errors = []

  if (recorded.sourceSha256 !== current.sourceSha256) {
    errors.push(
      'The canonical brand source changed without regenerating icons.'
    )
  }
  if (JSON.stringify(recordedSizes) !== JSON.stringify(expectedSizes)) {
    errors.push(
      `The generated manifest records [${recordedSizes.join(', ')}]; expected [${expectedSizes.join(', ')}].`
    )
  }

  for (const size of iconSizes) {
    if (recorded.icons?.[size]?.sha256 !== current.icons[size].sha256) {
      errors.push(`public/icon/${size}.png differs from its generated hash.`)
    }
  }

  if (errors.length > 0) {
    throw new Error(`${errors.join('\n')}\nRun pnpm brand:icons to regenerate.`)
  }

  console.log(`Verified ${iconSizes.length} canonical ContentLens icons.`)
}

const args = process.argv.slice(2)
const svg = createBrandIconSvg()

if (args.length === 0) {
  await generateIcons(svg)
} else if (args.length === 1 && args[0] === '--check') {
  await checkIcons(svg)
} else {
  throw new Error('Usage: generate-icons.mjs [--check]')
}
