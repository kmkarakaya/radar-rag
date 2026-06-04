import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('docs static contract', () => {
  it('does not contain old endpoints or stale config paths in README.md', async () => {
    const readmePath = path.resolve(process.cwd(), 'README.md');
    const content = await fs.readFile(readmePath, 'utf8');

    assert.ok(!content.includes('/rag/query'), 'Should not mention legacy /rag/query route');
    assert.ok(!content.includes('/rag/retrieve'), 'Should not mention legacy /rag/retrieve route');
    assert.ok(!content.includes('chroma.collection'), 'Should not mention stale chroma.collection config');
    assert.ok(!content.includes('data.indexSampleSize'), 'Should not mention stale data.indexSampleSize config');
    assert.ok(content.includes('/v1/admin/collections'), 'Should mention admin collection endpoint');
    assert.ok(content.includes('/v1/admin/jobs/'), 'Should mention admin job endpoint');
    assert.ok(content.includes('cleanup.retentionMs'), 'Should document retention cleanup config');
    assert.ok(content.includes('COLLECTION_FORBIDDEN'), 'Should document 403 forbidden collection behavior');
    assert.ok(content.includes('[src/app.ts](src/app.ts)'), 'Should describe the app composition layer explicitly');
    assert.ok(!content.includes('[src/server.ts](src/server.ts): HTTP API katmanı'), 'Should not misdescribe server.ts as the HTTP API layer');
  });

  it('does not contain old endpoints or stale config paths in architecture doc', async () => {
    const docPath = path.resolve(process.cwd(), 'vanilla_rag_backend_mimarisi.md');
    const content = await fs.readFile(docPath, 'utf8');

    assert.ok(!content.includes('GET /rag/query'), 'Should not mention legacy GET /rag/query route');
    assert.ok(!content.includes('GET /rag/retrieve'), 'Should not mention legacy GET /rag/retrieve route');
    assert.ok(!content.includes('POST /rag/query'), 'Should not mention legacy POST /rag/query route');
    assert.ok(!content.includes('POST /rag/retrieve'), 'Should not mention legacy POST /rag/retrieve route');
    assert.ok(!content.includes('chroma.collection'), 'Should not mention stale chroma.collection config');
    assert.ok(!content.includes('data.indexSampleSize'), 'Should not mention stale data.indexSampleSize config');
    assert.ok(content.includes('/v1/admin/collections'), 'Should describe the admin collection API');
    assert.ok(content.includes('delete_pending'), 'Should describe retention cleanup state');
    assert.ok(content.includes('cleanup_failed'), 'Should describe retryable cleanup failure state');
    assert.ok(content.includes('COLLECTION_FORBIDDEN'), 'Should describe 403 vs 404 access behavior');
    assert.ok(content.includes('modelAvailability'), 'Should describe collection-level model availability in readiness');
  });
});
