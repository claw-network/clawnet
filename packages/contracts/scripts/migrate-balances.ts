import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Migrate-balances — mint tokens on-chain to match the off-chain snapshot.
 *
 * Reads the snapshot JSON produced by `snapshot-balances.ts`, verifies all
 * DID holders have a registered ClawIdentity controller, then batch-mints
 * ClawToken to each unique address.
 *
 * The deployer account must hold MINTER_ROLE on ClawToken.
 *
 * Usage:
 *   TOKEN_ADDRESS=0x... IDENTITY_ADDRESS=0x... INPUT_FILE=snapshot-balances.json \
 *   npx hardhat run scripts/migrate-balances.ts --network clawnetTestnet
 *
 * Environment variables:
 *   TOKEN_ADDRESS      — deployed ClawToken proxy address (required)
 *   IDENTITY_ADDRESS   — deployed ClawIdentity proxy address (required)
 *   INPUT_FILE         — path to snapshot JSON (required)
 *   BATCH_SIZE         — mints per transaction batch (default: 50)
 *   DRY_RUN            — if "true", skip actual minting (default: false)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Running balance migration with account:", deployer.address);

  const tokenAddress = process.env.TOKEN_ADDRESS;
  const identityAddress = process.env.IDENTITY_ADDRESS;
  const inputFile = process.env.INPUT_FILE;
  const batchSize = parseInt(process.env.BATCH_SIZE ?? "50", 10);
  const dryRun = process.env.DRY_RUN === "true";

  if (!tokenAddress) throw new Error("TOKEN_ADDRESS env var is required");
  if (!identityAddress) throw new Error("IDENTITY_ADDRESS env var is required");
  if (!inputFile) throw new Error("INPUT_FILE env var is required");

  // ── 1. Load snapshot ──────────────────────────────────────────────
  const filePath = path.resolve(inputFile);
  const rawData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const entries: Array<{
    didHash: string;
    controller: string;
    balance: string;
  }> = rawData.entries ?? rawData;

  console.log(`\nLoaded ${entries.length} entries from ${filePath}`);
  console.log(`Batch size: ${batchSize}`);
  if (dryRun) console.log("⚠️  DRY RUN — no transactions will be sent\n");

  // ── 2. Deduplicate by address and sum balances ────────────────────
  // Multiple DIDs may share a controller; we mint once per address.
  const addressBalances = new Map<string, bigint>();
  for (const entry of entries) {
    const addr = entry.controller.toLowerCase();
    const balance = BigInt(entry.balance);
    // Use the balance directly — all DIDs with the same controller
    // share the same on-chain balance; don't double-count.
    addressBalances.set(addr, balance);
  }

  // Filter out zero balances
  const mintTargets: Array<{ address: string; balance: bigint }> = [];
  for (const [addr, balance] of addressBalances) {
    if (balance > 0n) {
      mintTargets.push({ address: addr, balance });
    }
  }

  console.log(`Unique addresses with non-zero balance: ${mintTargets.length}`);

  const expectedTotalMint = mintTargets.reduce(
    (sum, t) => sum + t.balance,
    0n,
  );
  console.log(`Total to mint: ${expectedTotalMint} Tokens`);

  // ── 3. Verify DID registration on ClawIdentity ────────────────────
  const identity = await ethers.getContractAt(
    "ClawIdentity",
    identityAddress,
  );
  const token = await ethers.getContractAt("ClawToken", tokenAddress);

  console.log("\nVerifying DID registrations on-chain...");
  let verifyFailed = 0;
  const unregistered: string[] = [];

  for (let i = 0; i < mintTargets.length; i += batchSize) {
    const batch = mintTargets.slice(i, i + batchSize);
    // Check that each address is a controller of at least one DID
    // We use the didHash from entries to check
    for (const target of batch) {
      // Find the original didHash for this address
      const entry = entries.find(
        (e) => e.controller.toLowerCase() === target.address,
      );
      if (!entry) continue;

      try {
        const controller = await identity.getController(entry.didHash);
        if (
          controller === ethers.ZeroAddress ||
          controller.toLowerCase() !== target.address
        ) {
          verifyFailed++;
          unregistered.push(target.address);
        }
      } catch {
        verifyFailed++;
        unregistered.push(target.address);
      }
    }
  }

  if (verifyFailed > 0) {
    console.warn(`\n⚠️  ${verifyFailed} addresses not registered on ClawIdentity`);
    console.warn("These will be skipped during minting:");
    for (const addr of unregistered) {
      console.warn(`  - ${addr}`);
    }
  }

  // Filter out unregistered
  const finalTargets = mintTargets.filter(
    (t) => !unregistered.includes(t.address),
  );
  console.log(`\nFinal mint targets: ${finalTargets.length}`);

  if (dryRun) {
    console.log("\n═══ DRY RUN COMPLETE — no transactions sent ═══");
    return;
  }

  // ── 4. Record pre-migration totalSupply ────────────────────────────
  const preTotalSupply = await token.totalSupply();
  console.log(`\nPre-migration totalSupply: ${preTotalSupply} Tokens`);

  // ── 5. Batch mint ─────────────────────────────────────────────────
  let totalMinted = 0n;
  let totalSuccess = 0;
  let totalFailed = 0;
  const failedAddresses: Array<{ address: string; balance: string; error: string }> = [];

  for (let i = 0; i < finalTargets.length; i += batchSize) {
    const batch = finalTargets.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    for (const target of batch) {
      try {
        const tx = await token.mint(target.address, target.balance);
        await tx.wait();
        totalMinted += target.balance;
        totalSuccess++;
      } catch (error: any) {
        totalFailed++;
        failedAddresses.push({
          address: target.address,
          balance: target.balance.toString(),
          error: error.message?.slice(0, 120) ?? "unknown",
        });
      }
    }

    console.log(
      `Batch ${batchNum}: ${batch.length} mints processed ` +
        `(${totalSuccess + totalFailed}/${finalTargets.length})`,
    );
  }

  // ── 6. Post-migration verification ────────────────────────────────
  const postTotalSupply = await token.totalSupply();
  const mintedByChain = BigInt(postTotalSupply.toString()) - BigInt(preTotalSupply.toString());

  console.log("\n═══ Migration Summary ═══");
  console.log(`Total targets          : ${finalTargets.length}`);
  console.log(`Successfully minted    : ${totalSuccess}`);
  console.log(`Failed                 : ${totalFailed}`);
  console.log(`Tokens minted (sum)    : ${totalMinted}`);
  console.log(`Chain Δ totalSupply    : ${mintedByChain}`);
  console.log(`Post totalSupply       : ${postTotalSupply}`);
  console.log(
    `Mint vs chain Δ match  : ${totalMinted === mintedByChain ? "✅ YES" : "⚠️  NO"}`,
  );

  if (failedAddresses.length > 0) {
    const failedPath = path.resolve("migration-failed-balances.json");
    fs.writeFileSync(failedPath, JSON.stringify(failedAddresses, null, 2));
    console.log(`\nFailed mints written to: ${failedPath}`);
  }

  // Write migration receipt
  const receipt = {
    timestamp: new Date().toISOString(),
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    tokenAddress,
    preTotalSupply: preTotalSupply.toString(),
    postTotalSupply: postTotalSupply.toString(),
    totalMinted: totalMinted.toString(),
    totalSuccess,
    totalFailed,
  };
  const receiptPath = path.resolve("migration-receipt-balances.json");
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(`Migration receipt: ${receiptPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
