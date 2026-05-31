import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.js";

let server: Server;
let baseUrl: string;

before(async () => {
  const app = createApp();

  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, init);
}

describe("app foundation", () => {
  it("serves liveness health", async () => {
    const response = await request("/health");
    const body = await response.json() as { status?: string; alive?: boolean };

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.alive, true);
  });

  it("points root callers to the versioned multi-collection API", async () => {
    const response = await request("/");
    const body = await response.json() as {
      endpoints?: Record<string, string>;
      message?: string;
    };

    assert.equal(response.status, 200);
    assert.match(body.message ?? "", /\/v1\/rag\/collections/);
    assert.equal(body.endpoints?.collections, "/v1/rag/collections");
    assert.equal(body.endpoints?.query, "/v1/rag/collections/:collectionId/query");
    assert.equal(body.endpoints?.retrieve, "/v1/rag/collections/:collectionId/retrieve");
  });

  it("returns a structured invalid JSON response with request context", async () => {
    const response = await request("/v1/rag/collections", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "foundation-test-request",
      },
      body: "{",
    });
    const body = await response.json() as {
      code?: string;
      requestId?: string;
    };

    assert.equal(response.status, 400);
    assert.equal(body.code, "INVALID_REQUEST_BODY");
    assert.equal(body.requestId, "foundation-test-request");
  });

  it("oversized JSON body kontrollü hata döner", async () => {
    // Generate a payload slightly larger than 1MB
    const largeString = "a".repeat(1024 * 1024 + 10);
    const response = await request("/v1/rag/collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: largeString }),
    });

    assert.equal(response.status, 413); // Payload Too Large

    // express built-in json parser might return html error for PayloadTooLarge depending on config
    // but at least verify status code
    try {
      const body = await response.json() as { error?: string };
      assert.match(body.error || "", /request entity too large|payload too large/i);
    } catch {
      const text = await response.text();
      assert.match(text, /Payload Too Large|request entity too large/i);
    }
  });

  it("does not expose legacy RAG endpoints", async () => {
    const legacyRequests: Array<[string, string, RequestInit | undefined]> = [
      ["GET", "/rag/query", undefined],
      ["POST", "/rag/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "test" }),
      }],
      ["GET", "/rag/retrieve", undefined],
      ["POST", "/rag/retrieve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "test", k: 1 }),
      }],
    ];

    for (const [method, path, init] of legacyRequests) {
      const response = await request(path, init);

      assert.equal(
        response.status,
        404,
        `${method} ${path} should be route-not-found, not a compatibility endpoint`,
      );
      assert.notEqual(response.status, 405);
    }
  });
});
