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
  });
});
