export interface ChromeSubmissionOptions {
  publisherId: string
  extensionId: string
  zipPath: string
  accessToken: string
  fetchImpl?: (url: string | URL, options?: RequestInit) => Promise<Response>
  waitImpl?: (milliseconds: number) => Promise<unknown>
  pollAttempts?: number
  pollIntervalMs?: number
}

export interface ChromeSubmissionResult {
  extensionId: string
  publisherId: string
  publishType: 'DEFAULT_PUBLISH'
  status: 'submitted'
}

export function submitChromePackage(
  options: ChromeSubmissionOptions
): Promise<ChromeSubmissionResult>
