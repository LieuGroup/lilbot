/** An error whose message is safe and useful to show to the user. */
export class LilBotError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}
