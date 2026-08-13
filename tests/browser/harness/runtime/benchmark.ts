export interface WorkerBenchmarkResult {
  lookupChecksum: number
  workerMs: number
}

export const runWorkerBenchmark = (
  candidateIds: readonly string[]
): WorkerBenchmarkResult => {
  const rules = new Map(
    candidateIds.map((candidateId, index) => [
      candidateId,
      index % 2 === 0 ? 'hide' : 'show'
    ])
  )
  const repetitions = 1_000
  let lookupChecksum = 0
  const startedAt = performance.now()

  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const candidateId of candidateIds) {
      lookupChecksum += rules.get(candidateId) === 'hide' ? 1 : 0
    }
  }

  return {
    lookupChecksum,
    workerMs: (performance.now() - startedAt) / repetitions
  }
}
