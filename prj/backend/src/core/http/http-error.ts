/** Application error carrying an HTTP status code and a stable error code. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }

  static badRequest(message: string, details?: unknown): HttpError {
    return new HttpError(400, 'BAD_REQUEST', message, details);
  }

  static forbidden(message: string, details?: unknown): HttpError {
    return new HttpError(403, 'FORBIDDEN', message, details);
  }

  static notFound(message: string, details?: unknown): HttpError {
    return new HttpError(404, 'NOT_FOUND', message, details);
  }

  static internal(message = 'Internal Server Error', details?: unknown): HttpError {
    return new HttpError(500, 'INTERNAL_ERROR', message, details);
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}
