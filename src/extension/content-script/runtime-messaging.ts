type RuntimeMessageSender<Message, Response> = (
  message: Message
) => Promise<Response>

type RuntimeMessageRetryOptions = {
  attempts: number
  delayMs: number
  wait?: (delayMs: number) => Promise<void>
}

const waitFor = (delayMs: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, delayMs)
  })

export async function sendRuntimeMessageWithRetry<Message, Response>(
  send: RuntimeMessageSender<Message, Response>,
  message: Message,
  options: RuntimeMessageRetryOptions
): Promise<Response> {
  let lastError: unknown
  const wait = options.wait ?? waitFor

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await send(message)
    } catch (error) {
      lastError = error
      if (attempt < options.attempts) {
        await wait(options.delayMs * attempt)
      }
    }
  }

  throw lastError
}
