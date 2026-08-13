export const SHARED_RUNNER_FACTOR = 3

export type BudgetRegime = 'reference-device' | 'shared-runner'

export const budgetRegime = (): BudgetRegime =>
  process.env.CI ? 'shared-runner' : 'reference-device'

export const effectiveBudgetMs = (budgetMs: number) =>
  budgetRegime() === 'shared-runner'
    ? budgetMs * SHARED_RUNNER_FACTOR
    : budgetMs
