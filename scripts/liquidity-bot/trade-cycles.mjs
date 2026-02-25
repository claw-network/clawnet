#!/usr/bin/env node

import { createRuntime, parseArgs, printScriptHelp, toInt } from './bot-lib.mjs';
import { runTradeCycles } from './steps.mjs';

async function main() {
  const args = parseArgs();
  if (args.help) {
    printScriptHelp(
      'trade-cycles.mjs',
      'Optional flags:\n  --cycles <n>     Number of buy/deliver/confirm cycles to execute.',
    );
    return;
  }
  const rt = await createRuntime(args);
  const cycles = args.cycles !== undefined ? toInt(args.cycles, 0) : undefined;
  if (cycles !== undefined && cycles <= 0) {
    throw new Error(`Invalid --cycles value: ${args.cycles}`);
  }
  await runTradeCycles(rt, { cycles });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error.message);
  process.exit(1);
});
