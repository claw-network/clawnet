import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";

/**
 * Reconcile — compare on-chain state vs off-chain indexer for every address,
 * escrow, and service contract.  Outputs a diff report.
 *
 * Checks:
 *   1. Token balances — on-chain balanceOf vs indexer-derived balance
 *   2. Escrow state   — on-chain getEscrow() vs indexer `escrows` table
 *   3. Contract state  — on-chain getContract() vs indexer `service_contracts`
 *   4. DID registration — on-chain getController() vs indexer `did_cache`
 *
 * Goal: 0 differences.
 *
 * Usage:
 *   TOKEN_ADDRESS=0x... ESCROW_ADDRESS=0x... CONTRACTS_ADDRESS=0x... \
 *   IDENTITY_ADDRESS=0x... DB_PATH=/path/to/indexer.sqlite \
 *   npx hardhat run scripts/reconcile.ts --network clawnetTestnet
 *
 * Environment variables:
 *   TOKEN_ADDRESS      — deployed ClawToken proxy (required)
 *   ESCROW_ADDRESS     — deployed ClawEscrow proxy (required)
 *   CONTRACTS_ADDRESS  — deployed ClawContracts proxy (required)
 *   IDENTITY_ADDRESS   — deployed ClawIdentity proxy (required)
 *   DB_PATH            — path to indexer.sqlite (required)
 *   OUTPUT_FILE        — report JSON path (default: reconcile-report.json)
 *   BATCH_SIZE         — queries per batch (default: 50)
 */

interface Discrepancy {
  type: "balance" | "escrow" | "contract" | "did";
  id: string;
  field: string;
  onChain: string;
  offChain: string;
}

async function main() {
  const tokenAddress = process.env.TOKEN_ADDRESS;
  const escrowAddress = process.env.ESCROW_ADDRESS;
  const contractsAddress = process.env.CONTRACTS_ADDRESS;
  const identityAddress = process.env.IDENTITY_ADDRESS;
  const dbPath = process.env.DB_PATH;
  const outputFile = process.env.OUTPUT_FILE ?? "reconcile-report.json";
  const batchSize = parseInt(process.env.BATCH_SIZE ?? "50", 10);

  if (!tokenAddress) throw new Error("TOKEN_ADDRESS env var is required");
  if (!escrowAddress) throw new Error("ESCROW_ADDRESS env var is required");
  if (!contractsAddress) throw new Error("CONTRACTS_ADDRESS env var is required");
  if (!identityAddress) throw new Error("IDENTITY_ADDRESS env var is required");
  if (!dbPath) throw new Error("DB_PATH env var is required");

  const resolvedDb = path.resolve(dbPath);
  if (!fs.existsSync(resolvedDb)) {
    throw new Error(`SQLite database not found at ${resolvedDb}`);
  }

  console.log("═══ Reconciliation ═══");
  console.log(`Token     : ${tokenAddress}`);
  console.log(`Escrow    : ${escrowAddress}`);
  console.log(`Contracts : ${contractsAddress}`);
  console.log(`Identity  : ${identityAddress}`);
  console.log(`SQLite DB : ${resolvedDb}`);

  const db = new Database(resolvedDb, { readonly: true });
  const token = await ethers.getContractAt("ClawToken", tokenAddress);
  const escrow = await ethers.getContractAt("ClawEscrow", escrowAddress);
  const contracts = await ethers.getContractAt("ClawContracts", contractsAddress);
  const identity = await ethers.getContractAt("ClawIdentity", identityAddress);

  const discrepancies: Discrepancy[] = [];
  const stats = {
    didsChecked: 0,
    balancesChecked: 0,
    escrowsChecked: 0,
    contractsChecked: 0,
    didsMatched: 0,
    balancesMatched: 0,
    escrowsMatched: 0,
    contractsMatched: 0,
  };

  // ── 1. DID reconciliation ────────────────────────────────────────
  console.log("\n[1/4] Reconciling DIDs...");
  const dids = db
    .prepare(
      `SELECT did_hash AS didHash, controller, active_key AS activeKey, is_active AS isActive
       FROM did_cache`,
    )
    .all() as Array<{
    didHash: string;
    controller: string;
    activeKey: string;
    isActive: number;
  }>;

  for (let i = 0; i < dids.length; i += batchSize) {
    const batch = dids.slice(i, i + batchSize);

    for (const did of batch) {
      stats.didsChecked++;
      try {
        const onChainController = await identity.getController(did.didHash);
        const offChainController = did.controller.toLowerCase();
        const onChainAddr = onChainController.toLowerCase();

        if (onChainAddr !== offChainController) {
          discrepancies.push({
            type: "did",
            id: did.didHash,
            field: "controller",
            onChain: onChainAddr,
            offChain: offChainController,
          });
        } else {
          stats.didsMatched++;
        }
      } catch {
        // DID not registered on-chain
        if (did.isActive === 1) {
          discrepancies.push({
            type: "did",
            id: did.didHash,
            field: "exists",
            onChain: "not_found",
            offChain: `active (controller: ${did.controller})`,
          });
        } else {
          stats.didsMatched++; // inactive DID not on-chain is expected
        }
      }
    }

    if ((i + batchSize) % 200 === 0 || i + batchSize >= dids.length) {
      console.log(`  DIDs: ${Math.min(i + batchSize, dids.length)}/${dids.length}`);
    }
  }

  // ── 2. Balance reconciliation ────────────────────────────────────
  console.log("\n[2/4] Reconciling balances...");

  // Collect unique addresses from DID cache
  const uniqueAddresses = new Set<string>();
  for (const did of dids) {
    uniqueAddresses.add(did.controller.toLowerCase());
  }

  // Compute expected balance from transfer history for each address
  const addressList = [...uniqueAddresses];
  for (let i = 0; i < addressList.length; i += batchSize) {
    const batch = addressList.slice(i, i + batchSize);

    for (const addr of batch) {
      stats.balancesChecked++;

      // On-chain balance
      let onChainBalance: bigint;
      try {
        onChainBalance = BigInt((await token.balanceOf(addr)).toString());
      } catch {
        onChainBalance = 0n;
      }

      // Indexer-derived balance: sum of incoming - sum of outgoing transfers
      const incoming = db
        .prepare(
          "SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) AS total FROM wallet_transfers WHERE to_addr = ?",
        )
        .get(addr.toLowerCase()) as { total: number };
      const outgoing = db
        .prepare(
          "SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) AS total FROM wallet_transfers WHERE from_addr = ?",
        )
        .get(addr.toLowerCase()) as { total: number };

      const indexerBalance = BigInt(incoming.total) - BigInt(outgoing.total);

      // Note: indexer balance may differ from on-chain if initial mint isn't
      // tracked as a transfer.  We report the diff but don't treat it as
      // critical if on-chain balance > 0 and indexer has no transfers.
      if (onChainBalance !== indexerBalance) {
        discrepancies.push({
          type: "balance",
          id: addr,
          field: "balance",
          onChain: onChainBalance.toString(),
          offChain: indexerBalance.toString(),
        });
      } else {
        stats.balancesMatched++;
      }
    }

    if ((i + batchSize) % 200 === 0 || i + batchSize >= addressList.length) {
      console.log(
        `  Balances: ${Math.min(i + batchSize, addressList.length)}/${addressList.length}`,
      );
    }
  }

  // ── 3. Escrow reconciliation ──────────────────────────────────────
  console.log("\n[3/4] Reconciling escrows...");
  const escrows = db
    .prepare(
      `SELECT escrow_id AS escrowId, depositor, beneficiary, arbiter,
              amount, status
       FROM escrows`,
    )
    .all() as Array<{
    escrowId: string;
    depositor: string;
    beneficiary: string;
    arbiter: string;
    amount: string;
    status: number;
  }>;

  for (let i = 0; i < escrows.length; i += batchSize) {
    const batch = escrows.slice(i, i + batchSize);

    for (const esc of batch) {
      stats.escrowsChecked++;
      const idHash = ethers.keccak256(ethers.toUtf8Bytes(esc.escrowId));

      try {
        const onChain = await escrow.getEscrow(idHash);
        const onChainStatus = Number(onChain.status ?? onChain[6]);
        let matched = true;

        // Compare status
        if (onChainStatus !== esc.status) {
          discrepancies.push({
            type: "escrow",
            id: esc.escrowId,
            field: "status",
            onChain: onChainStatus.toString(),
            offChain: esc.status.toString(),
          });
          matched = false;
        }

        // Compare beneficiary
        const onChainBeneficiary = (onChain.beneficiary ?? onChain[1]).toLowerCase();
        if (onChainBeneficiary !== esc.beneficiary.toLowerCase()) {
          discrepancies.push({
            type: "escrow",
            id: esc.escrowId,
            field: "beneficiary",
            onChain: onChainBeneficiary,
            offChain: esc.beneficiary.toLowerCase(),
          });
          matched = false;
        }

        // Compare amount (on-chain is net after fee)
        const onChainAmount = (onChain.amount ?? onChain[3]).toString();
        if (onChainAmount !== esc.amount) {
          discrepancies.push({
            type: "escrow",
            id: esc.escrowId,
            field: "amount",
            onChain: onChainAmount,
            offChain: esc.amount,
          });
          matched = false;
        }

        if (matched) stats.escrowsMatched++;
      } catch {
        // Escrow not found on-chain
        discrepancies.push({
          type: "escrow",
          id: esc.escrowId,
          field: "exists",
          onChain: "not_found",
          offChain: `status=${esc.status}, amount=${esc.amount}`,
        });
      }
    }

    if ((i + batchSize) % 100 === 0 || i + batchSize >= escrows.length) {
      console.log(
        `  Escrows: ${Math.min(i + batchSize, escrows.length)}/${escrows.length}`,
      );
    }
  }

  // ── 4. Service contract reconciliation ────────────────────────────
  console.log("\n[4/4] Reconciling service contracts...");
  const svcContracts = db
    .prepare(
      `SELECT contract_id AS contractId, client, provider, status
       FROM service_contracts`,
    )
    .all() as Array<{
    contractId: string;
    client: string;
    provider: string;
    status: number;
  }>;

  for (let i = 0; i < svcContracts.length; i += batchSize) {
    const batch = svcContracts.slice(i, i + batchSize);

    for (const ctr of batch) {
      stats.contractsChecked++;
      const idHash = ethers.keccak256(ethers.toUtf8Bytes(ctr.contractId));

      try {
        const onChain = await contracts.getContract(idHash);
        let matched = true;

        // Compare status
        const onChainStatus = Number(onChain.status);
        if (onChainStatus !== ctr.status) {
          discrepancies.push({
            type: "contract",
            id: ctr.contractId,
            field: "status",
            onChain: onChainStatus.toString(),
            offChain: ctr.status.toString(),
          });
          matched = false;
        }

        // Compare client
        const onChainClient = onChain.client.toLowerCase();
        if (onChainClient !== ctr.client.toLowerCase()) {
          discrepancies.push({
            type: "contract",
            id: ctr.contractId,
            field: "client",
            onChain: onChainClient,
            offChain: ctr.client.toLowerCase(),
          });
          matched = false;
        }

        // Compare provider
        const onChainProvider = onChain.provider.toLowerCase();
        if (onChainProvider !== ctr.provider.toLowerCase()) {
          discrepancies.push({
            type: "contract",
            id: ctr.contractId,
            field: "provider",
            onChain: onChainProvider,
            offChain: ctr.provider.toLowerCase(),
          });
          matched = false;
        }

        if (matched) stats.contractsMatched++;
      } catch {
        discrepancies.push({
          type: "contract",
          id: ctr.contractId,
          field: "exists",
          onChain: "not_found",
          offChain: `status=${ctr.status}, client=${ctr.client}`,
        });
      }
    }

    if ((i + batchSize) % 100 === 0 || i + batchSize >= svcContracts.length) {
      console.log(
        `  Contracts: ${Math.min(i + batchSize, svcContracts.length)}/${svcContracts.length}`,
      );
    }
  }

  db.close();

  // ── 5. Report ─────────────────────────────────────────────────────
  const report = {
    timestamp: new Date().toISOString(),
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    stats,
    totalDiscrepancies: discrepancies.length,
    discrepancies,
  };

  const reportPath = path.resolve(outputFile);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // ── 6. Summary ────────────────────────────────────────────────────
  const statusLine =
    discrepancies.length === 0 ? "✅ PASS — 0 discrepancies" : `⚠️  ${discrepancies.length} discrepancy(ies) found`;

  console.log("\n═══ Reconciliation Report ═══");
  console.log(`DIDs       : ${stats.didsMatched}/${stats.didsChecked} matched`);
  console.log(`Balances   : ${stats.balancesMatched}/${stats.balancesChecked} matched`);
  console.log(`Escrows    : ${stats.escrowsMatched}/${stats.escrowsChecked} matched`);
  console.log(`Contracts  : ${stats.contractsMatched}/${stats.contractsChecked} matched`);
  console.log(`\nResult     : ${statusLine}`);
  console.log(`Report     : ${reportPath}`);

  if (discrepancies.length > 0) {
    console.log("\nTop discrepancies:");
    for (const d of discrepancies.slice(0, 10)) {
      console.log(
        `  [${d.type}] ${d.id.slice(0, 20)}... — ${d.field}: on-chain=${d.onChain} vs off-chain=${d.offChain}`,
      );
    }
    if (discrepancies.length > 10) {
      console.log(`  ... and ${discrepancies.length - 10} more (see report file)`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
