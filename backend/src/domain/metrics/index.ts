import { getPool } from '../../db/pool';
import { activeSseConnections } from '../../realtime/sse';

export interface MetricSnapshot {
  nascon_active_ws_connections: number;
  nascon_active_streams_total: number;
  nascon_stream_bitrate_kbps: number;
  nascon_dlq_depth: number;
  nascon_qr_scans_total: number;
}

export async function collectMetrics(): Promise<MetricSnapshot> {
  const pool = getPool();
  const [streams, dlq, qr] = await Promise.all([
    pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM stream_keys WHERE status = 'active'`),
    pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM moderation_dlq`),
    pool.query<{ total: string }>(`SELECT COALESCE(SUM(scan_count), 0)::text AS total FROM qr_links`),
  ]);

  return {
    nascon_active_ws_connections: activeSseConnections(),
    nascon_active_streams_total: Number(streams.rows[0]?.count ?? 0),
    nascon_stream_bitrate_kbps: 0,
    nascon_dlq_depth: Number(dlq.rows[0]?.count ?? 0),
    nascon_qr_scans_total: Number(qr.rows[0]?.total ?? 0),
  };
}

export function formatPrometheusMetrics(snapshot: MetricSnapshot): string {
  const lines = [
    '# TYPE nascon_active_ws_connections gauge',
    `nascon_active_ws_connections ${snapshot.nascon_active_ws_connections}`,
    '# TYPE nascon_active_streams_total gauge',
    `nascon_active_streams_total ${snapshot.nascon_active_streams_total}`,
    '# TYPE nascon_stream_bitrate_kbps gauge',
    `nascon_stream_bitrate_kbps ${snapshot.nascon_stream_bitrate_kbps}`,
    '# TYPE nascon_dlq_depth gauge',
    `nascon_dlq_depth ${snapshot.nascon_dlq_depth}`,
    '# TYPE nascon_qr_scans_total counter',
    `nascon_qr_scans_total ${snapshot.nascon_qr_scans_total}`,
  ];
  return `${lines.join('\n')}\n`;
}
