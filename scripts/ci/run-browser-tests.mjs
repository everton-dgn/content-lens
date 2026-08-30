import { spawnSync } from 'node:child_process'

const testArguments = process.argv.slice(2)
const runsAllBrowserTests = testArguments.length === 0
const runsPackagedPanel = testArguments.some(
  argument => argument.includes('panel-open-smoke') || argument.includes('v01')
)
const runsProductionYoutubeFlow = testArguments.some(argument =>
  argument.includes('youtube-flow')
)
const runsWorkerRestart = testArguments.some(argument =>
  argument.includes('worker-restart')
)

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

if (runsAllBrowserTests || runsPackagedPanel) {
  run('pnpm', ['exec', 'wxt', 'build', '--browser', 'chrome'])
}

if (runsAllBrowserTests || runsProductionYoutubeFlow) {
  const config = 'wxt.adapter-e2e.config.ts'

  run('pnpm', [
    'exec',
    'wxt',
    'build',
    '--config',
    config,
    '--browser',
    'chrome'
  ])
}

if (runsAllBrowserTests || runsWorkerRestart) {
  const config = 'tests/browser/harness/runtime/wxt.config.ts'

  run('pnpm', [
    'exec',
    'wxt',
    'build',
    '--config',
    config,
    '--browser',
    'chrome'
  ])
}

run('pnpm', ['exec', 'playwright', 'test', ...testArguments])
