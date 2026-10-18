import type { FastifyInstance } from 'fastify';

import { eraseUserPrivacy } from '../domain/privacy';

export function registerPrivacy(app: FastifyInstance): void {
  app.delete<{ Params: { user_id: string } }>('/audit/v1/privacy/user/:user_id', async (request) =>
    eraseUserPrivacy(request.params.user_id),
  );
}
