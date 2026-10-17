import type { z } from 'zod';

import { AppError } from './errors';

export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  const fields = [
    ...new Set(result.error.issues.map((issue) => (issue.path.length > 0 ? String(issue.path[0]) : '(body)'))),
  ];
  throw new AppError(400, 'VALIDATION_ERROR', 'Request body failed validation.', { fields });
}
