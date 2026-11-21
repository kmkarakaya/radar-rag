import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IndexJobEvent } from "../src/collections/types.js";
import { isActiveJob, summarizeJobProgress } from "../src/indexing/jobProgress.js";

let sequence = 0;
function event(input: Partial<IndexJobEvent> & Pick<IndexJobEvent, "code" | "message">): IndexJobEvent {
  sequence += 1;
  return {
    id: `job-1:evt:${sequence}`,
    jobId: "job-1",
    tenantId: "default",
    collectionId: "col-1",
    sequence,
    status: "running",
    stage: "loading_source",
    level: "info",
    createdAt: "2026-11-21T00:00:00.000Z",
    ...input,
  } as IndexJobEvent;
}

describe("summarizeJobProgress", () => {
  it("knows nothing before the first event", () => {
    assert.deepEqual(summarizeJobProgress([]), {
      step: null,
      stepCount: null,
      percent: null,
      message: null,
      indexedFileCount: null,
      chunkCount: null,
    });
  });

  it("gives the last message when no event reports a step", () => {
    const progress = summarizeJobProgress([event({ code: "JOB_QUEUED", message: "Job queued." })]);
    assert.equal(progress.message, "Job queued.");
    assert.equal(progress.step, null);
    assert.equal(progress.percent, null);
  });

  it("computes the percent from the step and the items done within it", () => {
    const progress = summarizeJobProgress([
      event({ code: "SOURCE_ANALYSIS_COMPLETED", message: "Indexing source analysis completed.", progress: { phase: 3, phaseCount: 6 } }),
      event({
        code: "VECTOR_INDEXING_STARTED",
        message: "Writing chunks into the vector store.",
        progress: { phase: 5, phaseCount: 6, itemsCompleted: 50, itemsTotal: 100, unit: "chunks" },
      }),
    ]);
    assert.equal(progress.step, 5);
    assert.equal(progress.stepCount, 6);
    // (5 - 1 + 0.5) / 6 = 75%
    assert.equal(progress.percent, 75);
    assert.equal(progress.message, "Writing chunks into the vector store.");
  });

  it("uses the last event with a step when a later event has none, and clamps", () => {
    const progress = summarizeJobProgress([
      event({ code: "CHUNKING_COMPLETED", message: "Chunking completed.", progress: { phase: 6, phaseCount: 6, itemsCompleted: 9, itemsTotal: 3 } }),
      event({ code: "TARGET_RECORD_CREATED", message: "No step here." }),
    ]);
    assert.equal(progress.step, 6);
    assert.equal(progress.percent, 100);
    assert.equal(progress.message, "No step here.");
  });

  it("takes the latest file and chunk counts from the events", () => {
    const progress = summarizeJobProgress([
      event({ code: "SOURCE_ANALYSIS_COMPLETED", message: "Indexing source analysis completed.", details: { fileCount: 3, indexedFileCount: 2, parsedSourceDocumentCount: 22 } }),
      event({ code: "CHUNKING_COMPLETED", message: "Chunking completed.", details: { indexedFileCount: 2, documentCount: 22, chunkCount: 91 } }),
      event({ code: "TARGET_RECORD_CREATED", message: "Writing.", details: { chunkCount: "not a number" } }),
    ]);
    assert.equal(progress.indexedFileCount, 2);
    assert.equal(progress.chunkCount, 91);
  });
});

describe("isActiveJob", () => {
  it("is true only for queued and running jobs", () => {
    assert.equal(isActiveJob({ status: "queued" }), true);
    assert.equal(isActiveJob({ status: "running" }), true);
    assert.equal(isActiveJob({ status: "succeeded" }), false);
    assert.equal(isActiveJob({ status: "failed" }), false);
    assert.equal(isActiveJob({ status: "cancelled" }), false);
  });
});
