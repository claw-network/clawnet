import { execFileSync } from "node:child_process";
import path from "node:path";

const runIfEnabled = process.env.CLAWNET_BESU_PRECOMPILE_TEST === "1" ? describe : describe.skip;

runIfEnabled("Ed25519Verifier (Besu precompile)", function () {
  this.timeout(120_000);

  it("accepts valid signatures and rejects tampered signatures on a Besu backend", function () {
    const scriptPath = path.resolve(__dirname, "../../../scripts/test-ed25519-precompile.mjs");

    execFileSync(process.execPath, [scriptPath], {
      cwd: path.resolve(__dirname, "../../.."),
      env: {
        ...process.env,
        CLAWNET_BESU_PRECOMPILE_TEST: "1",
      },
      stdio: "inherit",
    });
  });
});