import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";

/**
 * Migrate-contracts — export Active service contracts from the indexer
 * and recreate them on-chain via ClawContracts.
 *
 * The migration recreates contracts in Draft state, then signs and activates
 * them.  Because the deployer acts as both client and signer, a simplified
 * flow is used:
 *
 *   1. Export active contracts from SQLite
 *   2. For each: deployer calls createContract() → signContract() (client) →
 *      the provider must also sign, but during migration the deployer
 *      creates the contract with itself as client (migration account).
 *   3. Temporarily set platformFeeBps=0 to avoid fee distortion.
 *
 * NOTE: For production migration, add a `migrateContract(...)` admin function
 * to ClawContracts that accepts explicit client/provider/status fields.
 *
 * Usage:
 *   TOKEN_ADDRESS=0x... CONTRACTS_ADDRESS=0x... DB_PATH=/path/to/indexer.sqlite \
 *   npx hardhat run scripts/migrate-contracts.ts --network clawnetTestnet
 *
 * Environment variables:
 *   TOKEN_ADDRESS      — deployed ClawToken proxy address (required)
 *   CONTRACTS_ADDRESS  — deployed ClawContracts proxy address (required)
 *   DB_PATH            — path to the node's indexer.sqlite file (required)
 *   OUTPUT_FILE        — export JSON path (default: contracts-export.json)
 *   BATCH_SIZE         — contracts per processing batch (default: 10)
 *   DRY_RUN            — if "true", export only, no on-chain writes
 *   EXPORT_ONLY        — if "true", only export JSON
 */
interface ExportedContract {
  contractId: string;      // original string ID from indexer
  contractIdHash: string;  // keccak256 bytes32
  client: string;
  provider: string;
  status: number;
  createdAt: number;
  updatedAt: number;
  // On-chain enriched fields (if available)
  arbiter: string;
  totalAmount: string;
  fundedAmount: string;
  releasedAmount: string;
  termsHash: string;
  milestoneCount: number;
  deadline: number;
  milestones: Array<{
    amount: string;
    deliverableHash: string;
    status: number;
    deadline: number;
  }>;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Running service contract migration with account:", deployer.address);

  const tokenAddress = process.env.TOKEN_ADDRESS;
  const contractsAddress = process.env.CONTRACTS_ADDRESS;
  const dbPath = process.env.DB_PATH;
  const outputFile = process.env.OUTPUT_FILE ?? "contracts-export.json";
  const batchSize = parseInt(process.env.BATCH_SIZE ?? "10", 10);
  const dryRun = process.env.DRY_RUN === "true";
  const exportOnly = process.env.EXPORT_ONLY === "true";

  if (!tokenAddress) throw new Error("TOKEN_ADDRESS env var is required");
  if (!contractsAddress) throw new Error("CONTRACTS_ADDRESS env var is required");
  if (!dbPath) throw new Error("DB_PATH env var is required");

  const resolvedDb = path.resolve(dbPath);
  if (!fs.existsSync(resolvedDb)) {
    throw new Error(`SQLite database not found at ${resolvedDb}`);
  }

  console.log("═══ Service Contract Migration ═══");
  console.log(`Token contract      : ${tokenAddress}`);
  console.log(`Contracts contract  : ${contractsAddress}`);
  console.log(`SQLite DB           : ${resolvedDb}`);
  console.log(`Mode                : ${exportOnly ? "EXPORT ONLY" : dryRun ? "DRY RUN" : "FULL MIGRATION"}`);

  // ── 1. Export active contracts from indexer ────────────────────────
  // Status 2 = Active (already signed and funded)
  const db = new Database(resolvedDb, { readonly: true });
  const rows = db
    .prepare(
      `SELECT contract_id AS contractId, client, provider, status,
              created_at AS createdAt, updated_at AS updatedAt
       FROM service_contracts
       WHERE status IN (1, 2)`,  // 1=Signed, 2=Active
    )
    .all() as Array<{
    contractId: string;
    client: string;
    provider: string;
    status: number;
    createdAt: number;
    updatedAt: number;
  }>;
  db.close();

  console.log(`\nFound ${rows.length} active/signed contracts in indexer database`);

  if (rows.length === 0) {
    console.log("No contracts to migrate.");
    fs.writeFileSync(
      path.resolve(outputFile),
      JSON.stringify({ timestamp: new Date().toISOString(), contracts: [] }, null, 2),
    );
    return;
  }

  // ── 2. Enrich with on-chain data ──────────────────────────────────
  const contracts = await ethers.getContractAt("ClawContracts", contractsAddress);
  const token = await ethers.getContractAt("ClawToken", tokenAddress);

  const exported: ExportedContract[] = [];

  for (const row of rows) {
    const idHash = ethers.keccak256(ethers.toUtf8Bytes(row.contractId));

    // Defaults for off-chain-only contracts
    let arbiter = ethers.ZeroAddress;
    let totalAmount = "0";
    let fundedAmount = "0";
    let releasedAmount = "0";
    let termsHash = ethers.ZeroHash;
    let milestoneCount = 1;
    let deadline = row.createdAt + 90 * 86400; // default: 90 day deadline
    const milestones: ExportedContract["milestones"] = [];

    try {
      const onChain = await contracts.getContract(idHash);
      arbiter = onChain.arbiter;
      totalAmount = onChain.totalAmount.toString();
      fundedAmount = onChain.fundedAmount.toString();
      releasedAmount = onChain.releasedAmount.toString();
      termsHash = onChain.termsHash;
      milestoneCount = Number(onChain.milestoneCount);
      deadline = Number(onChain.deadline);

      // Read milestones
      const onChainMilestones = await contracts.getMilestones(idHash);
      for (const m of onChainMilestones) {
        milestones.push({
          amount: m.amount.toString(),
          deliverableHash: m.deliverableHash,
          status: Number(m.status),
          deadline: Number(m.deadline),
        });
      }
    } catch {
      // Not on-chain — use indexer data as-is
      // Create a single milestone placeholder
      milestones.push({
        amount: "0",
        deliverableHash: ethers.ZeroHash,
        status: 0, // Pending
        deadline: deadline,
      });
    }

    exported.push({
      contractId: row.contractId,
      contractIdHash: idHash,
      client: row.client,
      provider: row.provider,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      arbiter,
      totalAmount,
      fundedAmount,
      releasedAmount,
      termsHash,
      milestoneCount,
      deadline,
      milestones,
    });
  }

  // ── 3. Write export JSON ──────────────────────────────────────────
  const totalValue = exported.reduce(
    (sum, c) => sum + BigInt(c.totalAmount),
    0n,
  );

  const exportData = {
    timestamp: new Date().toISOString(),
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    contractsAddress,
    totalContracts: exported.length,
    totalValue: totalValue.toString(),
    contracts: exported,
  };

  const exportPath = path.resolve(outputFile);
  fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
  console.log(`Export written to: ${exportPath}`);
  console.log(`Total contract value: ${totalValue} Tokens`);

  if (exportOnly) {
    console.log("\n═══ EXPORT ONLY — done ═══");
    return;
  }

  if (dryRun) {
    console.log("\n═══ DRY RUN — skipping on-chain writes ═══");
    return;
  }

  // ── 4. Only migrate contracts that have on-chain data ─────────────
  const migratable = exported.filter(
    (c) => BigInt(c.totalAmount) > 0n && c.arbiter !== ethers.ZeroAddress,
  );
  console.log(`\nMigratable contracts (with on-chain data): ${migratable.length}`);

  if (migratable.length === 0) {
    console.log("No contracts with on-chain data to migrate.");
    return;
  }

  // ── 5. Temporarily set platform fee to zero ───────────────────────
  console.log("\nSetting platform fee to zero for migration...");
  const origFeeBps = await contracts.platformFeeBps();
  const txFee = await contracts.setPlatformFeeBps(0);
  await txFee.wait();
  console.log(`Original platformFeeBps: ${origFeeBps} → set to 0`);

  // ── 6. Ensure deployer has enough tokens ──────────────────────────
  const totalNeeded = migratable.reduce(
    (sum, c) => sum + BigInt(c.fundedAmount),
    0n,
  );

  const deployerBalance = await token.balanceOf(deployer.address);
  if (BigInt(deployerBalance.toString()) < totalNeeded) {
    const deficit = totalNeeded - BigInt(deployerBalance.toString());
    console.log(`Minting ${deficit} Tokens to deployer for contract funding...`);
    const txMint = await token.mint(deployer.address, deficit);
    await txMint.wait();
  }

  // Approve contracts contract
  console.log(`Approving contracts contract for ${totalNeeded} Tokens...`);
  const txApprove = await token.approve(contractsAddress, totalNeeded);
  await txApprove.wait();

  // ── 7. Create contracts on-chain ──────────────────────────────────
  let totalCreated = 0;
  let totalFailed = 0;
  const failedContracts: Array<{ contractId: string; error: string }> = [];

  for (let i = 0; i < migratable.length; i += batchSize) {
    const batch = migratable.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    for (const ctr of batch) {
      try {
        // Prepare milestone data
        const milestoneAmounts = ctr.milestones.map((m) => BigInt(m.amount));
        const milestoneDeadlines = ctr.milestones.map((m) => {
          // Ensure deadline is in the future for creation
          return Math.max(m.deadline, Math.floor(Date.now() / 1000) + 86400);
        });

        // Ensure contract deadline is in the future
        const contractDeadline = Math.max(
          ctr.deadline,
          Math.floor(Date.now() / 1000) + 7 * 86400,
        );

        // Ensure milestone deadlines don't exceed contract deadline
        for (let j = 0; j < milestoneDeadlines.length; j++) {
          if (milestoneDeadlines[j] > contractDeadline) {
            milestoneDeadlines[j] = contractDeadline;
          }
        }

        const tx = await contracts.createContract(
          ctr.contractIdHash,
          ctr.provider,
          ctr.arbiter,
          BigInt(ctr.totalAmount),
          ctr.termsHash,
          contractDeadline,
          milestoneAmounts,
          milestoneDeadlines,
        );
        await tx.wait();
        totalCreated++;

        // If the original was Active (status=2), we would need to sign+activate.
        // But signing requires both client and provider msg.sender.
        // This is a limitation — see NOTE in header.
        console.log(`  Created contract ${ctr.contractId} (${ctr.contractIdHash.slice(0, 10)}...)`);
      } catch (error: any) {
        totalFailed++;
        failedContracts.push({
          contractId: ctr.contractId,
          error: error.message?.slice(0, 120) ?? "unknown",
        });
        console.error(`  FAILED ${ctr.contractId}: ${error.message?.slice(0, 80)}`);
      }
    }

    console.log(
      `Batch ${batchNum}: ${batch.length} contracts processed ` +
        `(${totalCreated + totalFailed}/${migratable.length})`,
    );
  }

  // ── 8. Restore original fee ───────────────────────────────────────
  console.log("\nRestoring original platform fee...");
  const txRestore = await contracts.setPlatformFeeBps(origFeeBps);
  await txRestore.wait();
  console.log(`platformFeeBps restored to: ${origFeeBps}`);

  // ── 9. Summary ────────────────────────────────────────────────────
  console.log("\n═══ Migration Summary ═══");
  console.log(`Total contracts in DB    : ${rows.length}`);
  console.log(`Migratable (with data)   : ${migratable.length}`);
  console.log(`Successfully created     : ${totalCreated}`);
  console.log(`Failed                   : ${totalFailed}`);
  console.log(`Total value              : ${totalValue} Tokens`);

  if (failedContracts.length > 0) {
    const failedPath = path.resolve("migration-failed-contracts.json");
    fs.writeFileSync(failedPath, JSON.stringify(failedContracts, null, 2));
    console.log(`Failed contracts written to: ${failedPath}`);
  }

  // Write migration receipt
  const receipt = {
    timestamp: new Date().toISOString(),
    totalInDb: rows.length,
    migratable: migratable.length,
    totalCreated,
    totalFailed,
    totalValue: totalValue.toString(),
  };
  const receiptPath = path.resolve("migration-receipt-contracts.json");
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(`Migration receipt: ${receiptPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
