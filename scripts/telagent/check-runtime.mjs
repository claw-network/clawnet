#!/usr/bin/env node

const BASELINE = {
  nodeMajor: 22,
  nodeRange: '>=22 <25',
  nodeRecommended: '22.19.0',
  pnpmRange: '>=10.18.1 <11',
};

const strict = process.argv.includes('--strict') || process.env.TELAGENT_RUNTIME_STRICT === '1';
const nodeVersion = process.versions.node;
const nodeMajor = Number.parseInt(nodeVersion.split('.')[0] ?? '0', 10);
const nodeOk = nodeMajor === BASELINE.nodeMajor;

const userAgent = process.env.npm_config_user_agent ?? '';
const pnpmMatch = userAgent.match(/pnpm\/(\d+\.\d+\.\d+)/);
const pnpmVersion = pnpmMatch?.[1] ?? 'unknown';
const pnpmMajor = Number.parseInt((pnpmVersion.split('.')[0] ?? '0'), 10);
const pnpmOk = pnpmVersion === 'unknown' ? true : pnpmMajor === 10;

console.log(`[runtime] node=${nodeVersion} expected=${BASELINE.nodeRange} recommended=${BASELINE.nodeRecommended}`);
console.log(`[runtime] pnpm=${pnpmVersion} expected=${BASELINE.pnpmRange}`);

let failed = false;
if (!nodeOk) {
  const msg = `[runtime] node major ${nodeMajor} is outside validated baseline (${BASELINE.nodeMajor}.x)`;
  if (strict) {
    console.error(msg);
    failed = true;
  } else {
    console.warn(`${msg}; continuing in non-strict mode`);
  }
}

if (!pnpmOk) {
  const msg = `[runtime] pnpm major ${pnpmMajor} is outside validated baseline (10.x)`;
  if (strict) {
    console.error(msg);
    failed = true;
  } else {
    console.warn(`${msg}; continuing in non-strict mode`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('[runtime] baseline check PASS');
}
