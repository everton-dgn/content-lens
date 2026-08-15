export interface ChromeSubmissionOptions {
  publisherId: string
  extensionId: string
  zipPath: string
  accessToken: string
  fetchImpl?: (url: string | URL, options?: RequestInit) => Promise<Response>
}

export interface ChromeSubmissionResult {
  extensionId: string
  publisherId: string
  publishType: 'STAGED_PUBLISH'
  status: 'submitted'
}

export function submitChromePackage(
  options: ChromeSubmissionOptions
): Promise<ChromeSubmissionResult>
