#!/usr/bin/env node

console.error(
  [
    '[deprecated] scripts/migrate-docs.mjs has been retired.',
    'Public canonical docs now live in apps/docs/content/docs and must be edited directly.',
    'See docs/DOCUMENTATION_GOVERNANCE.md for the current documentation rules.',
  ].join('\n'),
);

process.exit(1);
