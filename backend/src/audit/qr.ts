import type { FastifyInstance } from 'fastify';

import { exportPdf, exportPng, exportSvg, getQrEntity, redirectForShortCode } from '../domain/qr';

export function registerQr(app: FastifyInstance): void {
  app.get('/audit/v1/qr/:entity_id', async (request, reply) => {
    const { entity_id: entityId } = request.params as { entity_id: string };
    const inspect = (request.query as { inspect?: string }).inspect === 'true';
    const body = await getQrEntity(entityId, inspect);
    return reply.status(200).send(body);
  });

  app.get('/audit/v1/qr/:entity_id/export.svg', async (request, reply) => {
    const { entity_id: entityId } = request.params as { entity_id: string };
    const { body, contentType } = await exportSvg(entityId);
    return reply.status(200).header('Content-Type', contentType).send(body);
  });

  app.get('/audit/v1/qr/:entity_id/export.png', async (request, reply) => {
    const { entity_id: entityId } = request.params as { entity_id: string };
    const { body, contentType } = await exportPng(entityId);
    return reply.status(200).header('Content-Type', contentType).send(body);
  });

  app.get('/audit/v1/qr/:entity_id/export.pdf', async (request, reply) => {
    const { entity_id: entityId } = request.params as { entity_id: string };
    const { body, contentType } = await exportPdf(entityId);
    return reply.status(200).header('Content-Type', contentType).send(body);
  });

  app.get('/q/:short_code', async (request, reply) => {
    const { short_code: shortCode } = request.params as { short_code: string };
    const target = await redirectForShortCode(shortCode);
    return reply.redirect(target);
  });
}
