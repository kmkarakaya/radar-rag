import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { createSqliteCollectionRegistry, STALE_JOB_ERROR } from "../src/collections/sqliteRegistry.js";
import type { CollectionRegistry } from "../src/collections/types.js";
import { config } from "../src/config.js";
import { createIndexJobRunner } from "../src/indexing/jobRunner.js";
import { JOB_HEARTBEAT_INTERVAL_MS, runIndexJob } from "../src/indexing/jobs.js";

const context = { tenantId: "t", userId: "u", requestId: "r" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createRegistry() {
  return createSqliteCollectionRegistry({ dbPath: ":memory:" });
}

async function queuedJob(registry: CollectionRegistry) {
  const collection = await registry.createCollection(context, {
    displayName: "Docs",
    sourcePath: "data",
    embeddingModel: "m",
    distanceMetric: "l2",
    chunkSize: 500,
    chunkOverlap: 50,
    retrievalK: 5,
    retrievalDistanceThreshold: 1,
  });
  const job = await registry.beginIndexJob(context, collection.id);
  return { collection, job };
}

/** A physical build that never finishes and ignores the abort signal, like a model download. */
function stuckBuild(started: () => void) {
  return async () => {
    started();
    return new Promise<never>(() => {});
  };
}

describe("interrupted index jobs", () => {
  const registries: CollectionRegistry[] = [];
  afterEach(() => {
    mock.timers.reset();
    registries.splice(0).forEach((registry) => registry.close?.());
  });

  it("fails a job that stopped sending heartbeats, and keeps one that still sends them", async () => {
    const registry = createRegistry();
    registries.push(registry);
    const { collection, job } = await queuedJob(registry);
    await registry.markIndexJobRunning(job.id);

    await sleep(80);
    await registry.recordIndexJobHeartbeat(job.id);
    assert.equal(await registry.failStaleJobs(50), 0, "a fresh heartbeat keeps the job");

    await sleep(80);
    assert.equal(await registry.failStaleJobs(50), 1);
    const failed = await registry.getJob(job.id);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.error, STALE_JOB_ERROR);
    assert.notEqual((await registry.getVisibleCollection(context, collection.id))?.status, "indexing");
  });

  it("sends heartbeats while the job runs and stops when it ends", async () => {
    mock.timers.enable({ apis: ["setInterval"] });
    const registry = createRegistry();
    registries.push(registry);
    const { job } = await queuedJob(registry);
    const beats: string[] = [];
    const record = registry.recordIndexJobHeartbeat.bind(registry);
    registry.recordIndexJobHeartbeat = async (jobId: string) => {
      beats.push(jobId);
      return record(jobId);
    };

    let release!: (error: Error) => void;
    let buildStarted!: () => void;
    const started = new Promise<void>((resolve) => { buildStarted = resolve; });
    const run = runIndexJob({
      registry,
      jobId: job.id,
      runtimeConfig: config,
      log: () => {},
      deps: {
        buildPhysicalCollection: async () => {
          buildStarted();
          return new Promise<never>((_resolve, reject) => { release = reject; });
        },
      },
    });
    await started;

    mock.timers.tick(JOB_HEARTBEAT_INTERVAL_MS);
    mock.timers.tick(JOB_HEARTBEAT_INTERVAL_MS);
    assert.deepEqual(beats, [job.id, job.id]);

    release(new Error("boom"));
    assert.equal((await run).status, "failed");
    mock.timers.tick(JOB_HEARTBEAT_INTERVAL_MS);
    assert.equal(beats.length, 2, "no heartbeat after the job ended");
  });

  it("on shutdown, fails a job that does not stop in time instead of leaving it running", async () => {
    const registry = createRegistry();
    registries.push(registry);
    const { collection, job } = await queuedJob(registry);
    let buildStarted!: () => void;
    const started = new Promise<void>((resolve) => { buildStarted = resolve; });
    const runner = createIndexJobRunner({
      registry,
      runtimeConfig: config,
      log: () => {},
      shutdownGraceMs: 50,
      jobDeps: { buildPhysicalCollection: stuckBuild(buildStarted) },
    });

    runner.start(job.id);
    await started;
    await runner.shutdown();

    const failed = await registry.getJob(job.id);
    assert.equal(failed?.status, "failed");
    assert.match(failed?.error ?? "", /server stopped/);
    assert.notEqual((await registry.getVisibleCollection(context, collection.id))?.status, "indexing");
  });

  it("on shutdown, a job that stops on abort is failed with the reason, not cancelled", async () => {
    const registry = createRegistry();
    registries.push(registry);
    const { job } = await queuedJob(registry);
    let buildStarted!: () => void;
    const started = new Promise<void>((resolve) => { buildStarted = resolve; });
    const runner = createIndexJobRunner({
      registry,
      runtimeConfig: config,
      log: () => {},
      shutdownGraceMs: 1000,
      jobDeps: {
        buildPhysicalCollection: async (input) => {
          buildStarted();
          return new Promise<never>((_resolve, reject) => {
            input.signal?.addEventListener("abort", () => reject(new Error("Build aborted")));
          });
        },
      },
    });

    runner.start(job.id);
    await started;
    await runner.shutdown();

    const failed = await registry.getJob(job.id);
    assert.equal(failed?.status, "failed");
    assert.match(failed?.error ?? "", /server stopped/);
  });
});
