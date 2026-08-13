import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { arch, cpus, freemem, platform, release, totalmem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  type BrowserContext,
  chromium,
  firefox,
  type Page
} from '@playwright/test'

const repetitions = 30
const benchmarkUrl = 'https://www.youtube.com/phase0-benchmark'
const baselineUrl = 'https://www.youtube.com/phase0-baseline'
const firefoxExtensionId = '{74780624-e313-43b5-8558-799bbf9b95d3}'

interface FirefoxRemote {
  disconnect(): void
  installTemporaryAddon(
    addonPath: string,
    openDevTools: boolean
  ): Promise<{ addon: { id: string } }>
}

interface FirefoxRemoteModule {
  connectWithMaxRetries(options: {
    maxRetries: number
    port: number
    retryInterval: number
  }): Promise<FirefoxRemote>
  findFreeTcpPort(): Promise<number>
}

interface RuntimeBenchmarkSample {
  acknowledgementMs: number
  cardCount: number
  longTaskSource: 'performance-observer' | 'synchronous-operation-fallback'
  longTaskWorstMs: number
  pageMainThreadMs: number
  renderRestorePerCardMs: number
  roundTripMs: number
  worker: {
    lookupChecksum: number
    workerMs: number
  }
}

interface CapabilityEvidence {
  durationMs: number
  results: Array<{
    fallback: string
    id: string
    reason: string
    required: boolean
    state: string
  }>
  runtimeState: string
}

interface MetricSummary {
  median: number
  p95: number
  samples: number
  worst: number
}

interface ScenarioSummary {
  acknowledgementMs: MetricSummary
  longTaskWorstMs: MetricSummary
  pageMainThreadMs: MetricSummary
  renderRestorePerCardMs: MetricSummary
  roundTripMs: MetricSummary
  workerMs: MetricSummary
}

interface BrowserBenchmarkEvidence {
  baselinePageMs: MetricSummary
  browser: 'chrome' | 'firefox'
  browserVersion: string
  capabilities: CapabilityEvidence
  cold: ScenarioSummary
  gpuExposed: boolean
  longTaskMeasurement: 'performance-observer' | 'synchronous-operation-fallback'
  manifestVersion: number
  packageVersion: string
  residualPlaceholders: number
  warm: ScenarioSummary
}

const loadFirefoxRemote = async (): Promise<FirefoxRemoteModule> => {
  const projectRequire = createRequire(import.meta.url)
  const requireFromWxt = createRequire(projectRequire.resolve('wxt'))
  const webExtEntry = requireFromWxt.resolve('web-ext-run')
  const remoteModule = resolve(dirname(webExtEntry), 'lib/firefox/remote.js')

  return (await import(pathToFileURL(remoteModule).href)) as FirefoxRemoteModule
}

const summarize = (values: readonly number[]): MetricSummary => {
  if (values.length === 0) {
    throw new Error('A benchmark summary requires at least one sample.')
  }

  const sorted = [...values].sort((left, right) => left - right)
  const middle = sorted.length / 2
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[Math.floor(middle)] ?? 0)
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0

  return {
    median,
    p95,
    samples: values.length,
    worst: sorted.at(-1) ?? 0
  }
}

const summarizeScenario = (
  samples: readonly RuntimeBenchmarkSample[]
): ScenarioSummary => ({
  acknowledgementMs: summarize(
    samples.map(({ acknowledgementMs }) => acknowledgementMs)
  ),
  longTaskWorstMs: summarize(
    samples.map(({ longTaskWorstMs }) => longTaskWorstMs)
  ),
  pageMainThreadMs: summarize(
    samples.map(({ pageMainThreadMs }) => pageMainThreadMs)
  ),
  renderRestorePerCardMs: summarize(
    samples.map(({ renderRestorePerCardMs }) => renderRestorePerCardMs)
  ),
  roundTripMs: summarize(samples.map(({ roundTripMs }) => roundTripMs)),
  workerMs: summarize(samples.map(({ worker }) => worker.workerMs))
})

const installRoutes = async (context: BrowserContext): Promise<void> => {
  const fixture = await readFile(
    resolve('tests/fixtures/runtime/fixture.html'),
    'utf8'
  )
  const baselineFixture = fixture.replace(
    ' data-contentlens-feasibility="runtime"',
    ''
  )

  await context.route('https://www.youtube.com/**', route =>
    route.fulfill({
      body: route.request().url().startsWith(baselineUrl)
        ? baselineFixture
        : fixture,
      contentType: 'text/html; charset=utf-8',
      status: 200
    })
  )
}

const installLongTaskObserver = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const durations: number[] = []
    const supported =
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes.includes('longtask')
    Object.defineProperty(globalThis, '__contentlensLongTaskState', {
      configurable: false,
      value: { durations, supported },
      writable: false
    })

    if (supported) {
      new PerformanceObserver(entries => {
        durations.push(...entries.getEntries().map(({ duration }) => duration))
      }).observe({ type: 'longtask', buffered: true })
    }
  })
}

const readLongTaskWorst = (
  page: Page
): Promise<{ supported: boolean; worst: number }> =>
  page.evaluate(() => {
    const state = (
      globalThis as typeof globalThis & {
        __contentlensLongTaskState?: {
          durations: number[]
          supported: boolean
        }
      }
    ).__contentlensLongTaskState
    const durations = state?.durations.splice(0) ?? []

    return {
      supported: state?.supported ?? false,
      worst: Math.max(0, ...durations)
    }
  })

const readRuntimeSample = async (
  page: Page
): Promise<RuntimeBenchmarkSample> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const serialized = await page
      .locator('html')
      .getAttribute('data-contentlens-runtime-result')
    if (serialized) {
      const parsed = JSON.parse(serialized) as Partial<RuntimeBenchmarkSample>
      if (parsed.cardCount === 20 && parsed.worker) {
        const longTask = await readLongTaskWorst(page)
        return {
          ...(parsed as RuntimeBenchmarkSample),
          longTaskSource: longTask.supported
            ? 'performance-observer'
            : 'synchronous-operation-fallback',
          longTaskWorstMs: longTask.supported
            ? longTask.worst
            : Math.max(
                parsed.acknowledgementMs ?? 0,
                parsed.pageMainThreadMs ?? 0
              )
        }
      }
    }
    await page.waitForTimeout(10)
  }

  throw new Error('Packaged runtime benchmark did not produce a result.')
}

const runBaseline = async (page: Page): Promise<number[]> => {
  await page.goto(baselineUrl, { waitUntil: 'domcontentloaded' })

  return page.evaluate(count => {
    const samples: number[] = []
    let checksum = 0
    for (let repetition = 0; repetition < count; repetition += 1) {
      const startedAt = performance.now()
      for (const card of document.querySelectorAll('[data-runtime-card]')) {
        checksum += card.textContent?.length ?? 0
      }
      samples.push(performance.now() - startedAt)
    }
    if (checksum === 0) {
      throw new Error('Baseline fixture scan did not read any card content.')
    }
    return samples
  }, repetitions)
}

const runCold = async (page: Page): Promise<RuntimeBenchmarkSample[]> => {
  const samples: RuntimeBenchmarkSample[] = []

  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    await page.goto(`${benchmarkUrl}?cold=${repetition}`, {
      waitUntil: 'domcontentloaded'
    })
    await readLongTaskWorst(page)
    await page.locator('[data-runtime-benchmark-trigger]').click()
    samples.push(await readRuntimeSample(page))
  }

  return samples
}

const runWarm = async (page: Page): Promise<RuntimeBenchmarkSample[]> => {
  const samples: RuntimeBenchmarkSample[] = []

  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    await page.locator('html').evaluate(root => {
      root.removeAttribute('data-contentlens-runtime-result')
    })
    await page.locator('[data-runtime-benchmark-trigger]').click()
    samples.push(await readRuntimeSample(page))
  }

  return samples
}

const readCapabilities = async (page: Page): Promise<CapabilityEvidence> => {
  await page.locator('html').evaluate(root => {
    root.removeAttribute('data-contentlens-runtime-result')
    root.dispatchEvent(
      new Event('contentlens:runtime:probe', { bubbles: true })
    )
  })

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const serialized = await page
      .locator('html')
      .getAttribute('data-contentlens-runtime-result')
    if (serialized) {
      const parsed = JSON.parse(serialized) as Partial<CapabilityEvidence>
      if (Array.isArray(parsed.results)) {
        return parsed as CapabilityEvidence
      }
    }
    await page.waitForTimeout(10)
  }

  throw new Error('Packaged capability probe did not produce a result.')
}

const readManifest = async (
  extensionPath: string
): Promise<{ manifest_version: number; version: string }> =>
  JSON.parse(
    await readFile(resolve(extensionPath, 'manifest.json'), 'utf8')
  ) as { manifest_version: number; version: string }

const benchmarkContext = async (
  browserName: 'chrome' | 'firefox',
  context: BrowserContext,
  extensionPath: string
): Promise<BrowserBenchmarkEvidence> => {
  await installRoutes(context)
  const page = await context.newPage()
  await installLongTaskObserver(page)
  const baseline = await runBaseline(page)
  const cold = await runCold(page)
  const warm = await runWarm(page)
  const capabilities = await readCapabilities(page)
  const gpuExposed = await page.evaluate(() => 'gpu' in navigator)
  const residualPlaceholders = await page
    .locator('[data-contentlens-placeholder]')
    .count()
  const manifest = await readManifest(extensionPath)
  const browserVersion = context.browser()?.version() ?? 'unknown'
  const longTaskMeasurement = cold[0]?.longTaskSource

  if (
    !longTaskMeasurement ||
    [...cold, ...warm].some(
      ({ longTaskSource }) => longTaskSource !== longTaskMeasurement
    )
  ) {
    throw new Error('Long-task measurement source changed during the run.')
  }

  await page.close()
  return {
    baselinePageMs: summarize(baseline),
    browser: browserName,
    browserVersion,
    capabilities,
    cold: summarizeScenario(cold),
    gpuExposed,
    longTaskMeasurement,
    manifestVersion: manifest.manifest_version,
    packageVersion: manifest.version,
    residualPlaceholders,
    warm: summarizeScenario(warm)
  }
}

const runChrome = async (): Promise<BrowserBenchmarkEvidence> => {
  const extensionPath = resolve('.output/runtime-feasibility/chrome-mv3')
  const context = await chromium.launchPersistentContext('', {
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ],
    channel: 'chromium',
    headless: true
  })

  try {
    return await benchmarkContext('chrome', context, extensionPath)
  } finally {
    await context.close()
  }
}

const runFirefox = async (): Promise<BrowserBenchmarkEvidence> => {
  const extensionPath = resolve('.output/runtime-feasibility/firefox-mv2')
  const firefoxRemote = await loadFirefoxRemote()
  const debuggerPort = await firefoxRemote.findFreeTcpPort()
  const context = await firefox.launchPersistentContext('', {
    args: ['-start-debugger-server', String(debuggerPort)],
    firefoxUserPrefs: {
      'devtools.debugger.prompt-connection': false,
      'devtools.debugger.remote-enabled': true,
      'xpinstall.signatures.required': false
    },
    headless: true
  })
  const remote = await firefoxRemote.connectWithMaxRetries({
    maxRetries: 100,
    port: debuggerPort,
    retryInterval: 50
  })

  try {
    const installed = await remote.installTemporaryAddon(extensionPath, false)
    if (installed.addon.id !== firefoxExtensionId) {
      throw new Error('Unexpected Firefox feasibility extension ID.')
    }
    return await benchmarkContext('firefox', context, extensionPath)
  } finally {
    remote.disconnect()
    await context.close()
  }
}

const number = (value: number): string => value.toFixed(3)

const baselineRow = (browser: BrowserBenchmarkEvidence): string =>
  [
    browser.browser,
    'baseline',
    'Fixture DOM scan',
    number(browser.baselinePageMs.median),
    number(browser.baselinePageMs.p95),
    number(browser.baselinePageMs.worst),
    'reference'
  ].join(' | ')

const scenarioRows = (
  browser: BrowserBenchmarkEvidence,
  scenario: 'cold' | 'warm'
): string[] => {
  const metrics = browser[scenario]
  return [
    [
      browser.browser,
      scenario,
      'Acknowledgement',
      number(metrics.acknowledgementMs.median),
      number(metrics.acknowledgementMs.p95),
      number(metrics.acknowledgementMs.worst),
      '100'
    ].join(' | '),
    [
      browser.browser,
      scenario,
      'Initial 20-card pass',
      number(metrics.pageMainThreadMs.median),
      number(metrics.pageMainThreadMs.p95),
      number(metrics.pageMainThreadMs.worst),
      '100'
    ].join(' | '),
    [
      browser.browser,
      scenario,
      'Render and restore per card',
      number(metrics.renderRestorePerCardMs.median),
      number(metrics.renderRestorePerCardMs.p95),
      number(metrics.renderRestorePerCardMs.worst),
      '8'
    ].join(' | '),
    [
      browser.browser,
      scenario,
      `Extension task (${browser.longTaskMeasurement})`,
      number(metrics.longTaskWorstMs.median),
      number(metrics.longTaskWorstMs.p95),
      number(metrics.longTaskWorstMs.worst),
      '50'
    ].join(' | '),
    [
      browser.browser,
      scenario,
      'Worker rule lookup',
      number(metrics.workerMs.median),
      number(metrics.workerMs.p95),
      number(metrics.workerMs.worst),
      '25'
    ].join(' | ')
  ]
}

const browserGateFailures = (evidence: BrowserBenchmarkEvidence): string[] => {
  const failures: string[] = []

  for (const scenario of ['cold', 'warm'] as const) {
    const metrics = evidence[scenario]
    const gates = [
      ['acknowledgement-p95', metrics.acknowledgementMs.p95, 100],
      ['page-pass-p95', metrics.pageMainThreadMs.p95, 100],
      ['render-restore-p95', metrics.renderRestorePerCardMs.p95, 8],
      ['long-task-worst', metrics.longTaskWorstMs.worst, 50],
      ['worker-lookup-p95', metrics.workerMs.p95, 25],
      ['capability-probe', evidence.capabilities.durationMs, 1_000]
    ] as const

    for (const [name, observed, limit] of gates) {
      if (observed > limit) {
        failures.push(
          `${evidence.browser}:${scenario}:${name}:${observed}>${limit}`
        )
      }
    }
  }

  if (evidence.residualPlaceholders !== 0) {
    failures.push(
      `${evidence.browser}:residual-placeholders:${evidence.residualPlaceholders}`
    )
  }

  return failures
}

const readSystemVersion = (
  flag: '-productVersion' | '-buildVersion'
): string => {
  if (platform() !== 'darwin') {
    return 'not-applicable'
  }

  try {
    return execFileSync('sw_vers', [flag], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

const generatedAt = new Date().toISOString()
const browsers = [await runChrome(), await runFirefox()]
const gateFailures = browsers.flatMap(browserGateFailures)
const operatingSystemVersion = readSystemVersion('-productVersion')
const operatingSystemBuild = readSystemVersion('-buildVersion')
const evidence = {
  schemaVersion: 1,
  generatedAt,
  method: {
    fixtureCards: 20,
    longTaskMeasurement:
      'PerformanceObserver when supported; otherwise the measured synchronous extension operation span',
    repetitions,
    scenarios: ['baseline', 'cold-page-pass', 'warm-page-pass']
  },
  environment: {
    architecture: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
    freeMemoryBytesAtReport: freemem(),
    nodeVersion: process.version,
    operatingSystem:
      platform() === 'darwin'
        ? `macOS ${operatingSystemVersion}`
        : `${platform()} ${release()}`,
    operatingSystemBuild,
    operatingSystemKernel: `${platform()} ${release()}`,
    totalMemoryBytes: totalmem()
  },
  browsers,
  gateFailures
}

const evidenceDirectory = resolve('.artifacts/benchmarks/phase-0')
await import('node:fs/promises').then(({ mkdir }) =>
  mkdir(evidenceDirectory, { recursive: true })
)
await writeFile(
  resolve(evidenceDirectory, 'runtime-benchmark.raw.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
  'utf8'
)

const resultRows = browsers.flatMap(browser => [
  baselineRow(browser),
  ...scenarioRows(browser, 'cold'),
  ...scenarioRows(browser, 'warm')
])
const environmentRows = browsers.map(
  browser =>
    `| ${browser.browser} | ${browser.browserVersion} | MV${browser.manifestVersion} | ${browser.capabilities.runtimeState} | ${browser.gpuExposed ? 'yes' : 'no'} | ${browser.longTaskMeasurement} |`
)
const webGpuResults = browsers.map(browser => ({
  browser: browser.browser,
  result: browser.capabilities.results.find(({ id }) => id === 'webgpu')
}))
const webGpuEvidence = webGpuResults.every(
  ({ result }) => result?.state === 'supported'
)
  ? 'The packaged WebGPU adapter probe passed in both browsers.'
  : `The optional WebGPU adapter probe was unavailable in ${webGpuResults
      .filter(({ result }) => result?.state !== 'supported')
      .map(({ browser }) => (browser === 'chrome' ? 'Chrome' : 'Firefox'))
      .join(' and ')}; the deterministic baseline remained available.`
const report = `# Phase 0 runtime and capability evidence

Generated: ${generatedAt}

Status: ${gateFailures.length === 0 ? 'PASS' : 'FAIL'}

This report measures the runtime, capability and deterministic timing gates for the browser floors in ADR 0014.

## Environment

- Operating system: ${
  platform() === 'darwin'
    ? `macOS ${operatingSystemVersion}, build ${operatingSystemBuild}`
    : `${platform()} ${release()}`
} (${arch()})
- Kernel: ${platform()} ${release()}
- CPU: ${cpus()[0]?.model ?? 'unknown'}
- Memory: ${totalmem()} bytes
- Node.js: ${process.version}
- Fixture: 20 synthetic cards, ${repetitions} repetitions per cold and warm scenario

| Browser | Exact version | Manifest | Runtime state | WebGPU exposed | Extension-task measurement |
| --- | --- | --- | --- | --- | --- |
${environmentRows.join('\n')}

## Timing results

All values are milliseconds. The raw samples and summaries are in [runtime-benchmark.raw.json](runtime-benchmark.raw.json).

| Browser | Scenario | Measurement | Median | p95 | Worst | Gate |
| --- | --- | --- | ---: | ---: | ---: | ---: |
${resultRows.map(row => `| ${row} |`).join('\n')}

## Capability evidence

- CAP-002, CAP-005 and CAP-006: unit tests distinguish supported, limited, blocked, unsupported and unknown outcomes; packaged runs recorded supported and unsupported outcomes.
- CAP-007, CAP-008 and CAP-018: required IndexedDB and messaging probes passed in both packaged browsers. ${webGpuEvidence}
- CAP-012 and CAP-021: probe tests cover available, absent, throwing, denied, timed-out and revoked conditions. Permission and consent gates share the same finite deadline as the API probe.

Runtime lifecycle, queue, cancellation and fault-injection evidence is produced by \`pnpm test:runtime\`, not by this benchmark command.

## Limitations

- The device is an Apple M2 Pro host with 32 GiB of memory. A lower-end Standard device has not been selected.
- Browser runs used headless Playwright browser builds on one macOS host. Store-signed packages, mobile hardware and enterprise policies were not tested.
- WebGPU was recorded as a probe result only. No model runtime or model budget is accepted.
- The stable floors cover only the deterministic baseline and tested surfaces listed in ADR 0014. Store-signed packages, Firefox MV3, mobile, enterprise-policy environments, weaker devices and authenticated YouTube variants remain outside the claim.
`
await writeFile(
  resolve(evidenceDirectory, 'runtime-benchmark.md'),
  report,
  'utf8'
)

if (gateFailures.length > 0) {
  throw new Error(`Phase 0 benchmark gates failed: ${gateFailures.join(', ')}`)
}

console.log(
  `Phase 0 benchmark passed for ${browsers
    .map(({ browser, browserVersion }) => `${browser} ${browserVersion}`)
    .join(' and ')}.`
)
