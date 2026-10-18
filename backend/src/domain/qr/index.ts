import PDFDocument from 'pdfkit';

import { signDay2 } from '../../crypto/sign';
import { getPool } from '../../db/pool';
import { AppError } from '../../http/errors';
import { projectScore } from '../scoring';

interface QrRow {
  entity_id: string;
  entity_type: string;
  short_url: string;
  scan_count: number;
}

const BASE_URL = 'http://localhost:8080';

async function loadByEntityId(entityId: string): Promise<QrRow> {
  const pool = getPool();
  const result = await pool.query<QrRow>(
    'SELECT entity_id, entity_type, short_url, scan_count FROM qr_links WHERE entity_id = $1',
    [entityId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'QR_NOT_FOUND', 'QR link not found.', { entity_id: entityId });
  }
  return row;
}

async function loadByShortCode(shortCode: string): Promise<QrRow> {
  const pool = getPool();
  const suffix = `/q/${shortCode}`;
  const result = await pool.query<QrRow>(
    'SELECT entity_id, entity_type, short_url, scan_count FROM qr_links WHERE short_url LIKE $1',
    [`%${suffix}`],
  );
  const row = result.rows[0];
  if (!row || !row.short_url.endsWith(suffix)) {
    throw new AppError(404, 'QR_NOT_FOUND', 'QR link not found.', { short_code: shortCode });
  }
  return row;
}

export async function computeTargetRoute(entityId: string, entityType: string): Promise<string> {
  if (entityId.startsWith('cs-session-')) {
    return `/web/costream/${entityId}`;
  }
  if (entityType === 'player') {
    return `/web/players/${entityId}`;
  }
  if (entityType === 'club') {
    return `/web/clubs/${entityId}`;
  }
  if (entityType === 'match') {
    const score = await projectScore(entityId);
    const status = score.status;
    if (status === 'upcoming') return `/web/matches/${entityId}/preview`;
    if (status === 'in_progress') return `/web/matches/${entityId}/live`;
    if (status === 'completed') return `/web/matches/${entityId}/vod`;
    if (status === 'postponed' || status === 'cancelled' || status === 'abandoned') {
      return `/web/matches/${entityId}/notice?state=${status}`;
    }
    return `/web/matches/${entityId}/preview`;
  }
  throw new AppError(404, 'QR_NOT_FOUND', 'QR link not found.', { entity_id: entityId });
}

async function entityStatus(entityId: string, entityType: string): Promise<string> {
  if (entityType === 'match') {
    const score = await projectScore(entityId);
    return score.status;
  }
  return 'active';
}

function exportFormats(entityId: string): { svg: string; png: string; pdf: string } {
  const base = `${BASE_URL}/audit/v1/qr/${entityId}/export`;
  return {
    svg: `${base}.svg`,
    png: `${base}.png`,
    pdf: `${base}.pdf`,
  };
}

function buildResponse(row: QrRow, targetRoute: string, entityStatusValue: string): Record<string, unknown> {
  const signature = signDay2(row.entity_id, {
    entity_id: row.entity_id,
    short_url: row.short_url,
    target_route: targetRoute,
  });
  return {
    entity_id: row.entity_id,
    entity_type: row.entity_type,
    entity_status: entityStatusValue,
    short_url: row.short_url,
    target_route: targetRoute,
    scan_count: row.scan_count,
    signature,
    deep_link_uri: `nascon://entity/${row.entity_id}`,
    export_formats: exportFormats(row.entity_id),
  };
}

export async function getQrEntity(entityId: string, inspect: boolean): Promise<Record<string, unknown>> {
  const pool = getPool();
  let row: QrRow;
  if (inspect) {
    row = await loadByEntityId(entityId);
  } else {
    const updated = await pool.query<QrRow>(
      `UPDATE qr_links SET scan_count = scan_count + 1 WHERE entity_id = $1
       RETURNING entity_id, entity_type, short_url, scan_count`,
      [entityId],
    );
    row = updated.rows[0];
    if (!row) {
      throw new AppError(404, 'QR_NOT_FOUND', 'QR link not found.', { entity_id: entityId });
    }
  }
  const targetRoute = await computeTargetRoute(row.entity_id, row.entity_type);
  const status = await entityStatus(row.entity_id, row.entity_type);
  return buildResponse(row, targetRoute, status);
}

export async function redirectForShortCode(shortCode: string): Promise<string> {
  const row = await loadByShortCode(shortCode);
  return computeTargetRoute(row.entity_id, row.entity_type);
}

export function renderSvg(shortUrl: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><text x="10" y="20">${escapeXml(shortUrl)}</text></svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderPng(shortUrl: string): Buffer {
  return pngWithText(shortUrl);
}

function pdfLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function renderPdf(entityId: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ font: 'Helvetica', compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica');
    doc.page.write(`BT /F1 14 Tf 72 720 Td (${pdfLiteral(entityId)}) Tj ET\n`);
    doc.end();
  });
}

export async function exportSvg(entityId: string): Promise<{ body: string; contentType: string }> {
  const row = await loadByEntityId(entityId);
  return { body: renderSvg(row.short_url), contentType: 'image/svg+xml' };
}

export async function exportPng(entityId: string): Promise<{ body: Buffer; contentType: string }> {
  const row = await loadByEntityId(entityId);
  return { body: renderPng(row.short_url), contentType: 'image/png' };
}

export async function exportPdf(entityId: string): Promise<{ body: Buffer; contentType: string }> {
  await loadByEntityId(entityId);
  const body = await renderPdf(entityId);
  return { body, contentType: 'application/pdf' };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const combined = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crcBuf]);
}

function pngWithText(text: string): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idatData = Buffer.from([0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]);
  const textData = Buffer.from(`Comment\0${text}`, 'latin1');
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', textData),
    pngChunk('IDAT', idatData),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
