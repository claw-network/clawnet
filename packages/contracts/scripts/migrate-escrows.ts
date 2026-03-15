import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";

/**
 * Migrate-escrows — export Active escrows from the indexer and recreate on-chain.
 *
 * Phase 1: reads the node's SQLite indexer (`escrows` table) for Active
 * escrows and enriches them with on-chain details.
 *
 * Phase 2: recreates each escrow on the target chain via ClawEscrow.createEscrow().
 * To avoid fee distortion during migration, the script temporarily sets
 * fee parameters to zero, creates escrows, then restores the original fees.
 *
 * IMPORTANT: The deployer will be recorded as the `depositor` for all migrated
 * escrows.  For production migration, add a `migrateEscrow(...)` admin function
 * to ClawEscrow that accepts an explicit depositor field.
 *
 * Usage:
 *   TOKEN_ADDRESS=0x... ESCROW_ADDRESS=0x... DB_PATH=/path/to/indexer.sqlite \
 *   npx hardhat run scripts/migrate-escrows.ts --network clawnetTestnet
 *
 * Environment variables:
 *   TOKEN_ADDRESS    — deployed ClawToken proxy address (required)
 *   ESCROW_ADDRESS   — deployed ClawEscrow proxy address (required)
 *   DB_PATH          — path to the node's indexer.sqlite file (required)
 *   OUTPUT_FILE      — export JSON path (default: escrows-export.json)
 *   BATCH_SIZE       — escrows per processing batch (default: 20)
 *   DRY_RUN          — if "true", export only, no on-chain writes (default: false)
 *   EXPORT_ONLY      — if "true", only export JSON (skip on-chain migration)
 */
interface ExportedEscrow {
  escrowId: string;      // original string ID from indexer
  escrowIdHash: string;  // keccak256 bytes32
  depositor: string;
  beneficiary: string;
  arbiter: string;
  amount: string;        // net amount stored in the escrow
  status: number;        // 0=Active
  createdAt: number;
  updatedAt: number;
  expiresAt: number;     // from on-chain (if available), else createdAt + 30 days
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Running escrow migration with account:", deployer.address);

  const tokenAddress = process.env.TOKEN_ADDRESS;
  const escrowAddress = process.env.ESCROW_ADDRESS;
  const dbPath = process.env.DB_PATH;
  const outputFile = process.env.OUTPUT_FILE ?? "escrows-export.json";
  const batchSize = parseInt(process.env.BATCH_SIZE ?? "20", 10);
  const dryRun = process.env.DRY_RUN === "true";
  const exportOnly = process.env.EXPORT_ONLY === "true";

  if (!tokenAddress) throw new Error("TOKEN_ADDRESS env var is required");
  if (!escrowAddress) throw new Error("ESCROW_ADDRESS env var is required");
  if (!dbPath) throw new Error("DB_PATH env var is required");

  const resolvedDb = path.resolve(dbPath);
  if (!fs.existsSync(resolvedDb)) {
    throw new Error(`SQLite database not found at ${resolvedDb}`);
  }

  console.log("═══ Escrow Migration ═══");
  console.log(`Token contract  : ${tokenAddress}`);
  console.log(`Escrow contract : ${escrowAddress}`);
  console.log(`SQLite DB       : ${resolvedDb}`);
  console.log(`Mode            : ${exportOnly ? "EXPORT ONLY" : dryRun ? "DRY RUN" : "FULL MIGRATION"}`);

  // ── 1. Export active escrows from indexer ──────────────────────────
  const db = new Database(resolvedDb, { readonly: true });
  const rows = db
    .prepare(
      `SELECT escrow_id AS escrowId, depositor, beneficiary, arbiter,
              amount, status, created_at AS createdAt, updated_at AS updatedAt
       FROM escrows
       WHERE status = 0`,  // 0 = Active
    )
    .all() as Array<{
    escrowId: string;
    depositor: string;
    beneficiary: string;
    arbiter: string;
    amount: string;
    status: number;
    createdAt: number;
    updatedAt: number;
  }>;
  db.close();

  console.log(`\nFound ${rows.length} active escrows in indexer database`);

  if (rows.length === 0) {
    console.log("No active escrows to migrate.");
    fs.writeFileSync(
      path.resolve(outputFile),
      JSON.stringify({ timestamp: new Date().toISOString(), escrows: [] }, null, 2),
    );
    return;
  }

  // ── 2. Enrich with on-chain data (read expiresAt from source chain) ──
  const escrow = await ethers.getContractAt("ClawEscrow", escrowAddress);
  const token = await ethers.getContractAt("ClawToken", tokenAddress);

  const exported: ExportedEscrow[] = [];

  for (const row of rows) {
    const idHash = ethers.keccak256(ethers.toUtf8Bytes(row.escrowId));

    // Try to read existing on-chain escrow for expiresAt
    let expiresAt = row.createdAt + 30 * 86400; // default: 30 day expiry
    try {
      const onChain = await escrow.getEscrow(idHash);
      expiresAt = Number(onChain.expiresAt ?? onChain[5] ?? expiresAt);
    } catch {
      // Not on-chain yet (expected for off-chain-only escrows)
    }

    exported.push({
      escrowId: row.escrowId,
      escrowIdHash: idHash,
      depositor: row.depositor,
      beneficiary: row.beneficiary,
      arbiter: row.arbiter,
      amount: row.amount,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt,
    });
  }

  // ── 3. Write export JSON ──────────────────────────────────────────
  const totalAmount = exported.reduce(
    (sum, e) => sum + BigInt(e.amount),
    0n,
  );

  const exportData = {
    timestamp: new Date().toISOString(),
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    escrowAddress,
    totalEscrows: exported.length,
    totalLockedAmount: totalAmount.toString(),
    escrows: exported,
  };

  const exportPath = path.resolve(outputFile);
  fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
  console.log(`Export written to: ${exportPath}`);
  console.log(`Total locked amount: ${totalAmount} Tokens`);

  if (exportOnly) {
    console.log("\n═══ EXPORT ONLY — done ═══");
    return;
  }

  if (dryRun) {
    console.log("\n═══ DRY RUN — skipping on-chain writes ═══");
    return;
  }

  // ── 4. Temporarily set fees to zero ───────────────────────────────
  console.log("\nSetting escrow fees to zero for migration...");
  const origBaseRate = await escrow.baseRate();
  const origHoldingRate = await escrow.holdingRate();
  const origMinFee = await escrow.minEscrowFee();

  const txFees = await escrow.setFeeParams(0, 0, 0);
  await txFees.wait();
  console.log("Fee params zeroed (will restore after migration)");

  // ── 5. Mint tokens to deployer for escrow deposits ────────────────
  // The deployer needs `totalAmount` tokens to fund all escrows.
  const deployerBalance = await token.balanceOf(deployer.address);
  if (BigInt(deployerBalance.toString()) < totalAmount) {
    const deficit = totalAmount - BigInt(deployerBalance.toString());
    console.log(`Minting ${deficit} Tokens to deployer for escrow deposits...`);
    const txMint = await token.mint(deployer.address, deficit);
    await txMint.wait();
  }

  // Approve escrow contract
  console.log(`Approving escrow contract for ${totalAmount} Tokens...`);
  const txApprove = await token.approve(escrowAddress, totalAmount);
  await txApprove.wait();

  // ── 6. Create escrows on-chain ────────────────────────────────────
  let totalCreated = 0;
  let totalFailed = 0;
  const failedEscrows: Array<{ escrowId: string; error: string }> = [];

  for (let i = 0; i < exported.length; i += batchSize) {
    const batch = exported.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    for (const esc of batch) {
      try {
        // With fees=0, the full amount becomes the net amount stored
        const futureExpiry = Math.max(
          esc.expiresAt,
          Math.floor(Date.now() / 1000) + 86400, // at least 1 day from now
        );

        const tx = await escrow.createEscrow(
          esc.escrowIdHash,
          esc.beneficiary,
          esc.arbiter,
          BigInt(esc.amount),
          futureExpiry,
        );
        await tx.wait();
        totalCreated++;
      } catch (error: any) {
        totalFailed++;
        failedEscrows.push({
          escrowId: esc.escrowId,
          error: error.message?.slice(0, 120) ?? "unknown",
        });
      }
    }

    console.log(
      `Batch ${batchNum}: processed ${batch.length} escrows ` +
        `(${totalCreated + totalFailed}/${exported.length})`,
    );
  }

  // ── 7. Restore original fee parameters ────────────────────────────
  console.log("\nRestoring original fee parameters...");
  const txRestore = await escrow.setFeeParams(origBaseRate, origHoldingRate, origMinFee);
  await txRestore.wait();
  console.log(
    `Fee params restored: baseRate=${origBaseRate}, holdingRate=${origHoldingRate}, minFee=${origMinFee}`,
  );

  // ── 8. Summary ────────────────────────────────────────────────────
  console.log("\n═══ Migration Summary ═══");
  console.log(`Total active escrows   : ${exported.length}`);
  console.log(`Successfully created   : ${totalCreated}`);
  console.log(`Failed                 : ${totalFailed}`);
  console.log(`Total locked amount    : ${totalAmount} Tokens`);

  if (failedEscrows.length > 0) {
    const failedPath = path.resolve("migration-failed-escrows.json");
    fs.writeFileSync(failedPath, JSON.stringify(failedEscrows, null, 2));
    console.log(`Failed escrows written to: ${failedPath}`);
  }

  // Write migration receipt
  const receipt = {
    timestamp: new Date().toISOString(),
    totalExported: exported.length,
    totalCreated,
    totalFailed,
    totalLockedAmount: totalAmount.toString(),
  };
  const receiptPath = path.resolve("migration-receipt-escrows.json");
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(`Migration receipt: ${receiptPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
