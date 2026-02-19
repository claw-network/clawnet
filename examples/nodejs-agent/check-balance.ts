/**
 * Minimal example — check node status and wallet balance.
 *
 * Usage:
 *   node --loader ts-node/esm check-balance.ts
 */

import { ClawTokenClient } from '@clawtoken/sdk';

const client = new ClawTokenClient();

const status = await client.node.getStatus();
console.log('Node:', status.network, `block #${status.blockHeight}`, status.synced ? '(synced)' : '(syncing …)');

const balance = await client.wallet.getBalance();
console.log(`Balance : ${balance.balance} CLAW`);
console.log(`  available : ${balance.available}`);
console.log(`  pending   : ${balance.pending}`);
console.log(`  locked    : ${balance.locked}`);
