import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatStartupLinks } from "../src/server.js";

describe("server startup links", () => {
  it("prints the admin panel, readiness and test frontend URLs for the configured port", () => {
    const output = formatStartupLinks({ port: 4321 });

    assert.match(output, /Admin panel:\s+http:\/\/localhost:4321\/admin$/m);
    assert.match(output, /Readiness:\s+http:\/\/localhost:4321\/ready$/m);
    assert.match(output, /Test frontend:\s+http:\/\/localhost:4321\/test-frontend\/$/m);
  });
});
