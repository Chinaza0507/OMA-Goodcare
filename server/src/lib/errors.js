// An error with an HTTP status and a stable machine code. The client translates
// the code into the user's language, so the server never sends display text.
export class AppError extends Error {
  constructor(status, code, extra = {}) {
    super(code)
    this.status = status
    this.code = code
    this.extra = extra
  }
}
