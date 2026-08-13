import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { getPackage, parseArgs, run, stableJson } from './lib.mjs'

const spdxId = (name, version) =>
  `SPDXRef-Package-${createHash('sha256').update(`${name}@${version}`).digest('hex').slice(0, 16)}`

export const flattenDependencies = (dependencies = {}, found = new Map()) => {
  for (const [name, dependency] of Object.entries(dependencies)) {
    const version = dependency.version ?? 'NOASSERTION'
    const key = `${name}@${version}`
    if (!found.has(key)) {
      found.set(key, { name, version })
      flattenDependencies(dependency.dependencies, found)
    }
  }
  return [...found.values()].sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(
      `${right.name}@${right.version}`
    )
  )
}

export const createSbom = ({
  product,
  dependencies,
  commit,
  created = '1970-01-01T00:00:00.000Z'
}) => {
  const documentNamespace = `https://github.com/content-lens/content-lens/sbom/${commit}`
  const rootId = 'SPDXRef-Package-content-lens'
  const packages = [
    {
      SPDXID: rootId,
      name: product.name,
      versionInfo: product.version,
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: product.license ?? 'NOASSERTION',
      licenseDeclared: product.license ?? 'NOASSERTION',
      copyrightText: 'NOASSERTION'
    },
    ...dependencies.map(({ name, version }) => ({
      SPDXID: spdxId(name, version),
      name,
      versionInfo: version,
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: 'NOASSERTION',
      licenseDeclared: 'NOASSERTION',
      copyrightText: 'NOASSERTION',
      externalRefs: [
        {
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: `pkg:npm/${encodeURIComponent(name)}@${version}`
        }
      ]
    }))
  ]
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `${product.name}-${product.version}`,
    documentNamespace,
    creationInfo: {
      created: new Date(created).toISOString(),
      creators: ['Tool: content-lens-release/1'],
      licenseListVersion: '3.26'
    },
    packages,
    relationships: packages.slice(1).map(dependency => ({
      spdxElementId: rootId,
      relationshipType: 'DEPENDS_ON',
      relatedSpdxElement: dependency.SPDXID
    }))
  }
}

export const generateSbom = async ({ root, output, commit, created }) => {
  const product = await getPackage(root)
  const listed = JSON.parse(
    run('pnpm', ['list', '--prod', '--json', '--depth', 'Infinity'], {
      cwd: root,
      capture: true
    })
  )
  const dependencies = flattenDependencies(listed[0]?.dependencies)
  const sbom = createSbom({ product, dependencies, commit, created })
  await writeFile(output, stableJson(sbom), { flag: 'wx' })
  return sbom
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = parseArgs(process.argv.slice(2))
  if (typeof args.output !== 'string' || typeof args.commit !== 'string') {
    throw new Error('Usage: generate-sbom.mjs --output <path> --commit <sha>')
  }
  await generateSbom({
    root: process.cwd(),
    output: resolve(args.output),
    commit: args.commit
  })
  console.log(`Wrote SPDX 2.3 SBOM to ${args.output}.`)
}
