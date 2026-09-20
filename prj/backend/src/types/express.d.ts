/** Ambient augmentation: correlation id attached by RequestLoggerMiddleware. */
declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export {};
