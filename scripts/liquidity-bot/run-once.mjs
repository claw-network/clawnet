#!/usr/bin/env node

import { createRuntime, parseArgs, printScriptHelp, toInt } from './bot-lib.mjs';
import {
  fundOperators,
  healthCheck,
  publishListings,
  reconcile,
  runTradeCycles,
} from './steps.mjs';

async function main() {
  const args = parseArgs();
  if (args.help) {
    printScriptHelp(
      'run-once.mjs',
      [
        'Optional flags:',
        '  --count <n>         Number of listings to publish this run.',
        '  --cycles <n>        Number of trade cycles to execute.',
        '  --skip-publish      Skip listing publish step.',
        '  --skip-reconcile    Skip end-of-run reconcile step.',
      ].join('\n'),
    );
    return;
  }

  const rt = await createRuntime(args);
  const publishCount = args.count !== undefined ? toInt(args.count, 0) : undefined;
  const cycleCount = args.cycles !== undefined ? toInt(args.cycles, 0) : undefined;

  if (publishCount !== undefined && publishCount <= 0) {
    throw new Error(`Invalid --count value: ${args.count}`);
  }
  if (cycleCount !== undefined && cycleCount <= 0) {
    throw new Error(`Invalid --cycles value: ${args.cycles}`);
  }

  await healthCheck(rt);
  await fundOperators(rt);
  if (!args['skip-publish']) {
    await publishListings(rt, { count: publishCount });
  }
  await runTradeCycles(rt, { cycles: cycleCount });
  if (!args['skip-reconcile']) {
    await reconcile(rt);
  }
  await healthCheck(rt);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error.message);
  process.exit(1);
});
