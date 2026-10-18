#!/usr/bin/env node
/**
 * Approximate Day 2 line coverage from Node's test coverage report (run after ./run_tests.sh).
 * Writes COVERAGE_DAY2.json with measured percentages (integer, capped at 100).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BACKEND = path.join(ROOT, 'backend');

const BUCKETS = {
  streaming: [
    'backend/src/domain/stream/',
    'backend/src/audit/stream.ts',
  ],
  costream: [
    'backend/src/domain/costream/',
    'backend/src/audit/costream.ts',
  ],
  qr_guest: [
    'backend/src/domain/qr/',
    'backend/src/domain/guest/',
    'backend/src/domain/web/',
    'backend/src/audit/qr.ts',
    'backend/src/audit/guest.ts',
    'backend/src/audit/web.ts',
  ],
  moderation_dlq: [
    'backend/src/domain/moderation/',
    'backend/src/audit/moderation.ts',
  ],
  observability: [
    'backend/src/domain/metrics/',
    'backend/src/domain/privacy/',
    'backend/src/audit/metrics.ts',
    'backend/src/audit/privacy.ts',
    'backend/src/media/probe.ts',
    'backend/src/audit/health.ts',
  ],
};

function listTestFiles() {
  const out = spawnSync('find', [path.join(ROOT, 'tests'), '-name', '*.test.ts', '-not', '-name', '._*'], {
    encoding: 'utf8',
  });
  return out.stdout.trim().split('\n').filter(Boolean);
}

function parseCoverage(stdout) {
  const lines = stdout.split('\n');
  const files = {};
  for (const line of lines) {
    const m = line.match(/^ℹ\s+(\S+)\s+\|\s+([\d.]+)/);
    if (m && m[1] !== 'file' && m[1] !== 'all' && !m[1].startsWith('-')) {
      files[m[1]] = parseFloat(m[2]);
    }
  }
  return files;
}

function bucketScore(fileCoverage, prefixes) {
  const hits = [];
  for (const [file, pct] of Object.entries(fileCoverage)) {
    const norm = file.replace(/\\/g, '/');
    if (prefixes.some((p) => norm.includes(p.replace(/\\/g, '/')))) {
      hits.push(pct);
    }
  }
  if (hits.length === 0) return null;
  return Math.round(hits.reduce((a, b) => a + b, 0) / hits.length);
}

const testFiles = listTestFiles();
const result = spawnSync(
  'node',
  ['--import', 'tsx', '--experimental-test-coverage', '--test', '--test-concurrency=1', ...testFiles],
  { cwd: BACKEND, encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'postgres://sideline:sideline@127.0.0.1:5433/sideline' } },
);

const fileCoverage = parseCoverage(result.stdout + result.stderr);
const out = {};
for (const [name, prefixes] of Object.entries(BUCKETS)) {
  const score = bucketScore(fileCoverage, prefixes);
  out[name] = score ?? 0;
}

const outPath = path.join(ROOT, 'COVERAGE_DAY2.json');
fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log('Wrote', outPath, out);
if (result.status !== 0) {
  console.error('run_tests with coverage exited', result.status);
  process.exit(result.status);
}
