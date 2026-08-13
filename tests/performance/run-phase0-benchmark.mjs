import { spawnSync } from 'node:child_process'

const run = (command, arguments_) => {
  const result = spawnSync(command, arguments_, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'inherit'
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

for (const browser of ['chrome', 'firefox']) {
  run('pnpm', [
    'exec',
    'wxt',
    'build',
    '--config',
    'tests/browser/harness/runtime/wxt.config.ts',
    '--browser',
    browser
  ])
}

run('node', ['tests/performance/phase0-benchmark.ts'])
run('pnpm', [
  'exec',
  'biome',
  'format',
  '--write',
  '.artifacts/benchmarks/phase-0/runtime-benchmark.raw.json'
])
