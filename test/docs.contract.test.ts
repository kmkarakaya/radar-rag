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
    assert.ok(content.includes('[src/app.ts](src/app.ts)'), 'Should describe the app composition layer explicitly');
    assert.ok(!content.includes('[src/server.ts](src/server.ts): HTTP API katmanı'), 'Should not misdescribe server.ts as the HTTP API layer');
    assert.ok(content.includes('docs/operations.md'), 'Should link the operations guide');
    assert.ok(content.includes('docs/configuration.md'), 'Should link the configuration guide');
  });

  it('documents the index lifecycle and discovery contract in docs/operations.md', async () => {
    const content = await fs.readFile(path.resolve(process.cwd(), 'docs/operations.md'), 'utf8');

    assert.ok(content.includes('/v1/admin/collections'), 'Should mention admin collection endpoint');
    assert.ok(content.includes('/v1/admin/jobs/'), 'Should mention admin job endpoint');
    assert.ok(content.includes('cleanup.retentionMs'), 'Should document retention cleanup config');
    assert.ok(content.includes('readyUrl'), 'Should document collection discovery readyUrl');
    assert.ok(content.includes('does not return query/retrieve capability flags'), 'Should document list endpoint capability boundary');
    assert.ok(content.includes('`activeVersion` and `chunkCount` fields stay `null`'), 'Should document stable null fields for unindexed collection discovery');
    assert.ok(content.includes('delete_pending'), 'Should document pending physical cleanup state');
    assert.ok(content.includes('cleanup_failed'), 'Should document retryable cleanup failure state');
    assert.ok(content.includes('failed_build'), 'Should document failed build physical state');
    assert.ok(content.includes('idempotent not-found'), 'Should document idempotent not-found cleanup behavior');
    assert.ok(content.includes('COLLECTION_FORBIDDEN'), 'Should document 403 forbidden collection behavior');
    assert.ok(content.includes('[src/app.ts](../src/app.ts)'), 'Should describe the app composition layer explicitly');
  });

  it('does not contain old endpoints or stale config paths in architecture doc', async () => {
    const docPath = path.resolve(process.cwd(), 'radar_rag_mimarisi.md');
    const content = await fs.readFile(docPath, 'utf8');

    assert.ok(!content.includes('GET /rag/query'), 'Should not mention legacy GET /rag/query route');
    assert.ok(!content.includes('GET /rag/retrieve'), 'Should not mention legacy GET /rag/retrieve route');
    assert.ok(!content.includes('POST /rag/query'), 'Should not mention legacy POST /rag/query route');
    assert.ok(!content.includes('POST /rag/retrieve'), 'Should not mention legacy POST /rag/retrieve route');
    assert.ok(!content.includes('chroma.collection'), 'Should not mention stale chroma.collection config');
    assert.ok(!content.includes('data.indexSampleSize'), 'Should not mention stale data.indexSampleSize config');
    assert.ok(content.includes('/v1/admin/collections'), 'Should describe the admin collection API');
    assert.ok(content.includes('readyUrl'), 'Should describe collection discovery links');
    assert.ok(content.includes('Liste sadece registry-level discovery kontratıdır'), 'Should describe list endpoint as cheap registry discovery');
    assert.ok(content.includes('activeVersion` ve `chunkCount` alanları `null`'), 'Should describe stable null fields for unindexed collection discovery');
    assert.ok(content.includes('delete_pending'), 'Should describe retention cleanup state');
    assert.ok(content.includes('cleanup_failed'), 'Should describe retryable cleanup failure state');
    assert.ok(content.includes('deleted_at'), 'Should describe successful cleanup timestamp semantics');
    assert.ok(content.includes('failed_build'), 'Should describe failed build physical state');
    assert.ok(content.includes('idempotent başarı'), 'Should describe idempotent storage missing delete behavior');
    assert.ok(content.includes('COLLECTION_FORBIDDEN'), 'Should describe 403 vs 404 access behavior');
    assert.ok(content.includes('modelAvailability'), 'Should describe collection-level model availability in readiness');
    assert.ok(content.includes('hasActivePhysicalCollection'), 'Should document hasActivePhysicalCollection boolean in readiness');
    assert.ok(!content.includes('activePhysicalCollection'), 'Should not expose internal activePhysicalCollection name in public documentation');
  });

  it('keeps admin auth hardening visible across onboarding and integration docs', async () => {
    const [readme, docsReadme, handoff, promptTemplate, workflows] = await Promise.all([
      fs.readFile(path.resolve(process.cwd(), 'README.md'), 'utf8'),
      fs.readFile(path.resolve(process.cwd(), 'docs/README.md'), 'utf8'),
      fs.readFile(path.resolve(process.cwd(), 'docs/frontend_agent_handoff.md'), 'utf8'),
      fs.readFile(path.resolve(process.cwd(), 'docs/coding_agent_prompt_template.md'), 'utf8'),
      fs.readFile(path.resolve(process.cwd(), 'docs/http_workflows.md'), 'utf8'),
    ]);

    assert.ok(readme.includes('RAG_ADMIN_SESSION_SECRET'), 'README should document the admin session secret env var');
    assert.ok(readme.includes('.local/rag_admin_session.secret'), 'README should document the local secret file fallback');
    assert.ok(readme.includes('npm run admin:hash-password'), 'README should document password hash generation');
    assert.ok(readme.includes('/admin/login'), 'README should document the admin login redirect');
    assert.ok(readme.includes('Secure admin quickstart'), 'README should distinguish secure admin onboarding');
    assert.ok(docsReadme.includes('derive those values from the active session'), 'docs/README should explain session-derived admin tenant/user headers');
    assert.ok(handoff.includes('session-derived values for `/v1/admin/**`'), 'Frontend handoff should explain the admin header boundary');
    assert.ok(promptTemplate.includes('session-derived tenant/user context'), 'Prompt template should explain the admin header boundary');
    assert.ok(workflows.includes('ignores caller-supplied tenant/user headers'), 'HTTP workflows should explain ignored admin tenant/user headers');
    assert.ok(workflows.includes('/v1/admin/auth/action-token'), 'HTTP workflows should document the action-token endpoint');
  });
});
