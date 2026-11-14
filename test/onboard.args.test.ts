import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs } from "../src/admin/onboard.js";

describe("onboarding CLI arguments", () => {
  it("asks only the main choices by default and everything with --advanced", () => {
    assert.equal(parseArgs([]).advanced, false);
    const options = parseArgs(["--advanced", "--dry-run"]);
    assert.equal(options.advanced, true);
    assert.equal(options.dryRun, true);
  });

  it("rejects unknown arguments", () => {
    assert.throws(() => parseArgs(["--everything"]), /Unknown argument: --everything/);
  });
});
