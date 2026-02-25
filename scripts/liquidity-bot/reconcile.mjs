#!/usr/bin/env node

import { createRuntime, parseArgs, printScriptHelp } from './bot-lib.mjs';
import { reconcile } from './steps.mjs';

async function main() {
  const args = parseArgs();
  if (args.help) {
    printScriptHelp('reconcile.mjs');
    return;
  }
  const rt = await createRuntime(args);
  await reconcile(rt);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error.message);
  process.exit(1);
});
