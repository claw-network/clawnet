import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";

/**
 * Snapshot-balances — export all DID holders and their on-chain Token balances.
 *
 * Reads the node's SQLite indexer database (`did_cache` table) to enumerate
 * all known DID → controller address mappings, then reads each address's
 * on-chain balance from ClawToken.
 *
 * Output: JSON array of `{ didHash, controller, balance }` written to disk.
 *
 * Usage:
 *   TOKEN_ADDRESS=0x... DB_PATH=/path/to/indexer.sqlite \
 *   npx hardhat run scripts/snapshot-balances.ts --network clawnetTestnet
 *
 * Environment variables:
 *   TOKEN_ADDRESS   — deployed ClawToken proxy address (required)
 *   DB_PATH         — path to the node's indexer.sqlite file (required)
 *   OUTPUT_FILE     — output JSON path (default: snapshot-balances.json)
 *   BATCH_SIZE      — number of balanceOf calls per batch (default: 100)
 */
async function main() {
  const tokenAddress = process.env.TOKEN_ADDRESS;
  const dbPath = process.env.DB_PATH;
  const outputFile = process.env.OUTPUT_FILE ?? "snapshot-balances.json";
  const batchSize = parseInt(process.env.BATCH_SIZE ?? "100", 10);

  if (!tokenAddress) throw new Error("TOKEN_ADDRESS env var is required");
  if (!dbPath) throw new Error("DB_PATH env var is required");

  const resolvedDb = path.resolve(dbPath);
  if (!fs.existsSync(resolvedDb)) {
    throw new Error(`SQLite database not found at ${resolvedDb}`);
  }

  console.log("═══ Snapshot Balances ═══");
  console.log(`Token contract : ${tokenAddress}`);
  console.log(`SQLite DB      : ${resolvedDb}`);
  console.log(`Output file    : ${outputFile}`);
  console.log(`Batch size     : ${batchSize}`);

  // ── 1. Read all active DIDs from the indexer database ──────────────
  const db = new Database(resolvedDb, { readonly: true });
  const rows = db
    .prepare(
      `SELECT did_hash AS didHash, controller, active_key AS activeKey, is_active AS isActive
       FROM did_cache
       WHERE is_active = 1`,
    )
    .all() as Array<{
    didHash: string;
    controller: string;
    activeKey: string;
    isActive: number;
  }>;
  db.close();

  console.log(`\nFound ${rows.length} active DIDs in indexer database`);

  if (rows.length === 0) {
    console.log("No active DIDs found. Writing empty snapshot.");
    fs.writeFileSync(path.resolve(outputFile), JSON.stringify([], null, 2));
    return;
  }

  // ── 2. Deduplicate by controller address ───────────────────────────
  // Multiple DIDs could share a controller; we snapshot per-address.
  const addressToDids = new Map<string, string[]>();
  for (const row of rows) {
    const addr = row.controller.toLowerCase();
    const dids = addressToDids.get(addr) ?? [];
    dids.push(row.didHash);
    addressToDids.set(addr, dids);
  }

  const uniqueAddresses = [...addressToDids.keys()];
  console.log(`Unique controller addresses: ${uniqueAddresses.length}`);

  // ── 3. Read on-chain balances ──────────────────────────────────────
  const token = await ethers.getContractAt("ClawToken", tokenAddress);

  interface SnapshotEntry {
    didHash: string;
    controller: string;
    balance: string;
  }

  const snapshot: SnapshotEntry[] = [];
  let totalBalance = 0n;
  let queriedCount = 0;

  for (let i = 0; i < uniqueAddresses.length; i += batchSize) {
    const batch = uniqueAddresses.slice(i, i + batchSize);

    // Query balances in parallel within the batch
    const balances = await Promise.all(
      batch.map((addr) => token.balanceOf(addr)),
    );

    for (let j = 0; j < batch.length; j++) {
      const addr = batch[j];
      const balance = balances[j];
      const dids = addressToDids.get(addr)!;

      // For each DID pointing to this address, record balance (on the first DID)
      // All DIDs sharing a controller share the same balance.
      for (const didHash of dids) {
        snapshot.push({
          didHash,
          controller: addr,
          balance: balance.toString(),
        });
      }

      totalBalance += BigInt(balance.toString());
    }

    queriedCount += batch.length;
    if (queriedCount % 500 === 0 || queriedCount === uniqueAddresses.length) {
      console.log(
        `  Queried ${queriedCount}/${uniqueAddresses.length} addresses...`,
      );
    }
  }

  // ── 4. Also get the on-chain totalSupply as reference ──────────────
  const totalSupply = await token.totalSupply();

  // ── 5. Write output ────────────────────────────────────────────────
  const outputPath = path.resolve(outputFile);
  const output = {
    timestamp: new Date().toISOString(),
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    tokenAddress,
    totalSupply: totalSupply.toString(),
    snapshotBalanceSum: totalBalance.toString(),
    uniqueAddresses: uniqueAddresses.length,
    totalDids: rows.length,
    entries: snapshot,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  // ── 6. Summary ────────────────────────────────────────────────────
  const nonZero = snapshot.filter((e) => e.balance !== "0");
  console.log("\n═══ Snapshot Summary ═══");
  console.log(`Total DIDs             : ${rows.length}`);
  console.log(`Unique addresses       : ${uniqueAddresses.length}`);
  console.log(`Non-zero balances      : ${nonZero.length}`);
  console.log(`Sum of balances        : ${totalBalance} Tokens`);
  console.log(`On-chain totalSupply   : ${totalSupply} Tokens`);
  console.log(`Match                  : ${totalBalance === BigInt(totalSupply.toString()) ? "✅ YES" : "⚠️  NO (discrepancy)"}`);
  console.log(`Output written to      : ${outputPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
