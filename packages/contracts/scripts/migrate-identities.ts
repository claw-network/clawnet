import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Batch-register DIDs from a JSON file into ClawIdentity contract.
 *
 * Input JSON format: Array of objects:
 *   [
 *     { "did": "did:claw:z6Mk...", "publicKey": "0x<hex 32 bytes>", "evmAddress": "0x..." },
 *     ...
 *   ]
 *
 * Usage:
 *   IDENTITY_ADDRESS=0x... INPUT_FILE=dids.json BATCH_SIZE=50 \
 *   npx hardhat run scripts/migrate-identities.ts --network clawnetTestnet
 *
 * Environment variables:
 *   IDENTITY_ADDRESS  — deployed ClawIdentity proxy address (required)
 *   INPUT_FILE        — path to JSON file with DID data (required)
 *   BATCH_SIZE        — number of DIDs per tx (default: 50)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Running DID migration with account:", deployer.address);

  const identityAddress = process.env.IDENTITY_ADDRESS;
  const inputFile = process.env.INPUT_FILE;
  const batchSize = parseInt(process.env.BATCH_SIZE ?? "50", 10);

  if (!identityAddress) throw new Error("IDENTITY_ADDRESS env var is required");
  if (!inputFile) throw new Error("INPUT_FILE env var is required");

  // Load DID data
  const filePath = path.resolve(inputFile);
  const rawData = fs.readFileSync(filePath, "utf-8");
  const didEntries: Array<{
    did: string;
    publicKey: string;
    evmAddress: string;
    purpose?: number;
  }> = JSON.parse(rawData);

  console.log(`Loaded ${didEntries.length} DIDs from ${filePath}`);
  console.log(`Batch size: ${batchSize}`);

  // Connect to contract
  const identity = await ethers.getContractAt("ClawIdentity", identityAddress);

  let totalRegistered = 0;
  let totalFailed = 0;
  const failedDids: string[] = [];

  // Process in batches
  for (let i = 0; i < didEntries.length; i += batchSize) {
    const batch = didEntries.slice(i, i + batchSize);

    const didHashes: string[] = [];
    const publicKeys: string[] = [];
    const purposes: number[] = [];
    const controllers: string[] = [];

    for (const entry of batch) {
      didHashes.push(ethers.keccak256(ethers.toUtf8Bytes(entry.did)));
      publicKeys.push(entry.publicKey);
      purposes.push(entry.purpose ?? 0); // default: Authentication
      controllers.push(entry.evmAddress);
    }

    try {
      const tx = await identity.batchRegisterDID(didHashes, publicKeys, purposes, controllers);
      const receipt = await tx.wait();
      totalRegistered += batch.length;
      console.log(
        `Batch ${Math.floor(i / batchSize) + 1}: ` +
        `${batch.length} DIDs registered (tx: ${receipt!.hash}, gas: ${receipt!.gasUsed})`,
      );
    } catch (error: any) {
      totalFailed += batch.length;
      for (const entry of batch) {
        failedDids.push(entry.did);
      }
      console.error(
        `Batch ${Math.floor(i / batchSize) + 1}: FAILED — ${error.message?.slice(0, 100)}`,
      );
    }
  }

  // Summary
  console.log("\n═══ Migration Summary ═══");
  console.log(`Total DIDs in file : ${didEntries.length}`);
  console.log(`Successfully registered: ${totalRegistered}`);
  console.log(`Failed              : ${totalFailed}`);

  if (failedDids.length > 0) {
    const failedPath = path.resolve("migration-failed.json");
    fs.writeFileSync(failedPath, JSON.stringify(failedDids, null, 2));
    console.log(`Failed DIDs written to: ${failedPath}`);
  }

  // Verify count
  const onChainCount = await identity.didCount();
  console.log(`On-chain didCount   : ${onChainCount}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
