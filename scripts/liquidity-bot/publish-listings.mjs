#!/usr/bin/env node

import { createRuntime, parseArgs, printScriptHelp, toInt } from './bot-lib.mjs';
import { publishListings } from './steps.mjs';

async function main() {
  const args = parseArgs();
  if (args.help) {
    printScriptHelp(
      'publish-listings.mjs',
      'Optional flags:\n  --count <n>      Number of listings to publish in this run.',
    );
    return;
  }
  const rt = await createRuntime(args);
  const count = args.count !== undefined ? toInt(args.count, 0) : undefined;
  if (count !== undefined && count <= 0) {
    throw new Error(`Invalid --count value: ${args.count}`);
  }
  await publishListings(rt, { count });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error.message);
  process.exit(1);
});
