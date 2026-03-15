#!/usr/bin/env node

import { createRuntime, parseArgs, printScriptHelp } from '../lib/bot-lib.mjs';
import { healthCheck } from '../lib/steps.mjs';

async function main() {
  const args = parseArgs();
  if (args.help) {
    printScriptHelp('cli/health-check.mjs');
    return;
  }
  const rt = await createRuntime(args);
  await healthCheck(rt);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error.message);
  process.exit(1);
});
