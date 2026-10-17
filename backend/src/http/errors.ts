import type { FastifyError, FastifyInstance } from 'fastify';

export type ErrorDetails = Record<string, unknown>;

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: ErrorDetails;

  constructor(statusCode: number, code: string, message: string, details: ErrorDetails = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function notImplemented(what: string): never {
  throw new AppError(501, 'NOT_IMPLEMENTED', `${what} is not implemented yet.`);
}

export function errorBody(code: string, message: string, details: ErrorDetails = {}) {
  return { error: { code, message, details } };
}

// Empty bodies parse to undefined so optional-body routes like /audit/v1/reset accept them.
export function registerJsonParser(app: FastifyInstance): void {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new AppError(400, 'VALIDATION_ERROR', 'Request body is not valid JSON.', { fields: [] }), undefined);
    }
  });
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError, request, reply) => {
    if (err instanceof AppError) {
      if (err.code === 'RATE_LIMITED' && err.details.retry_after !== undefined) {
        reply.header('Retry-After', String(err.details.retry_after));
      }
      const message =
        err.code === 'NOT_IMPLEMENTED' ? `${request.method} ${request.routeOptions.url}: ${err.message}` : err.message;
      return reply.status(err.statusCode).send(errorBody(err.code, message, err.details));
    }

    const fastifyCode = (err as FastifyError).code;
    if (fastifyCode === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send(errorBody('PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB.'));
    }
    if (
      fastifyCode === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
      fastifyCode === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
      fastifyCode === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ||
      err instanceof SyntaxError
    ) {
      return reply.status(400).send(errorBody('VALIDATION_ERROR', 'Request body is not valid JSON.', { fields: [] }));
    }

    request.log.error(err);
    return reply.status(500).send(errorBody('INTERNAL', 'Unexpected server error.'));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(errorBody('NOT_FOUND', `Route ${request.method} ${request.url} does not exist.`));
  });
}
