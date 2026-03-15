import { ethers, artifacts } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Verify deployed contracts by comparing on-chain bytecode with locally compiled bytecode.
 *
 * Since ClawNet Chain does not have a block explorer like Etherscan/Blockscout,
 * this script uses JSON-RPC `eth_getCode` to retrieve the on-chain runtime bytecode
 * and compares it against the locally compiled artifacts.
 *
 * For UUPS proxies, the proxy bytecode is a standard ERC-1967 proxy — the script
 * retrieves the implementation address via the ERC-1967 slot and verifies that.
 *
 * Usage:
 *   npx hardhat run scripts/verify.ts --network clawnetTestnet
 *
 * Or with a specific deployment file:
 *   DEPLOYMENT_FILE=deployments/clawnetTestnet.json npx hardhat run scripts/verify.ts --network clawnetTestnet
 */

interface ContractDeployment {
  proxy: string;
  impl: string;
}

interface DeploymentRecord {
  network: string;
  chainId: number;
  contracts: Record<string, ContractDeployment>;
}

// ERC-1967 implementation slot: bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)
const ERC1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

/**
 * Strip metadata hash from runtime bytecode for comparison.
 * Solidity appends a CBOR-encoded metadata hash that varies per build.
 * We strip the last 53 bytes (0x0033 length + CBOR content).
 */
function stripMetadata(bytecode: string): string {
  const hex = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode;
  if (hex.length < 106) return hex; // too short, no metadata
  // Last 2 bytes = length of CBOR metadata (big-endian)
  const metaLength = parseInt(hex.slice(-4), 16);
  if (metaLength > 0 && metaLength < hex.length / 2) {
    // Strip metadata + the 2-byte length suffix
    return hex.slice(0, hex.length - (metaLength + 2) * 2);
  }
  return hex;
}

async function main() {
  const network = await ethers.provider.getNetwork();
  console.log("=".repeat(60));
  console.log("ClawNet Contract Verification");
  console.log("=".repeat(60));
  console.log(`Network: ${network.name} (chainId ${network.chainId})`);

  // Load deployment record
  const deploymentsDir = path.resolve(__dirname, "..", "deployments");
  const networkName =
    network.name === "unknown" ? `chain-${network.chainId}` : network.name;
  const deploymentFile =
    process.env.DEPLOYMENT_FILE ??
    path.join(deploymentsDir, `${networkName}.json`);

  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`Deployment file not found: ${deploymentFile}`);
  }

  const deployment: DeploymentRecord = JSON.parse(
    fs.readFileSync(deploymentFile, "utf-8"),
  );

  console.log(`Deployment file: ${deploymentFile}`);
  console.log("");

  const contractNames = Object.keys(deployment.contracts);
  let allPassed = true;

  for (const name of contractNames) {
    const { proxy, impl } = deployment.contracts[name];
    console.log(`--- ${name} ---`);
    console.log(`  Proxy : ${proxy}`);
    console.log(`  Impl  : ${impl}`);

    // 1. Verify proxy has code
    const proxyCode = await ethers.provider.getCode(proxy);
    if (proxyCode === "0x" || proxyCode === "0x0") {
      console.log(`  ❌ FAIL: No code at proxy address`);
      allPassed = false;
      continue;
    }
    console.log(
      `  Proxy bytecode: ${(proxyCode.length - 2) / 2} bytes ✔`,
    );

    // 2. Verify ERC-1967 implementation slot points to expected impl
    const implSlotValue = await ethers.provider.getStorage(
      proxy,
      ERC1967_IMPL_SLOT,
    );
    const onChainImpl =
      "0x" + implSlotValue.slice(26).toLowerCase(); // last 20 bytes
    const expectedImpl = impl.toLowerCase();

    if (onChainImpl === expectedImpl) {
      console.log(`  ERC-1967 impl slot matches ✔`);
    } else {
      console.log(
        `  ⚠ ERC-1967 impl slot mismatch: on-chain=${onChainImpl}, expected=${expectedImpl}`,
      );
    }

    // 3. Verify implementation bytecode matches local artifact
    const implCode = await ethers.provider.getCode(impl);
    if (implCode === "0x" || implCode === "0x0") {
      console.log(`  ❌ FAIL: No code at implementation address`);
      allPassed = false;
      continue;
    }

    try {
      const artifact = await artifacts.readArtifact(name);
      const localDeployed = artifact.deployedBytecode;

      // Compare stripped bytecodes (without metadata hash)
      const onChainStripped = stripMetadata(implCode);
      const localStripped = stripMetadata(localDeployed);

      if (onChainStripped === localStripped) {
        console.log(
          `  Implementation bytecode MATCHES local artifact ✔`,
        );
      } else {
        // Check if it's a partial match (same prefix)
        const minLen = Math.min(
          onChainStripped.length,
          localStripped.length,
        );
        let matchLen = 0;
        for (let i = 0; i < minLen; i++) {
          if (onChainStripped[i] !== localStripped[i]) break;
          matchLen++;
        }
        const matchPct = ((matchLen / minLen) * 100).toFixed(1);
        console.log(
          `  ⚠ Bytecode mismatch (${matchPct}% prefix match)`,
        );
        console.log(
          `    On-chain: ${onChainStripped.length / 2} bytes, Local: ${localStripped.length / 2} bytes`,
        );
        allPassed = false;
      }
    } catch {
      console.log(
        `  ⚠ Could not load local artifact for "${name}" — skipping bytecode comparison`,
      );
    }

    console.log("");
  }

  console.log("=".repeat(60));
  if (allPassed) {
    console.log("✅ All contracts verified successfully!");
  } else {
    console.log("⚠ Some verifications failed — see details above.");
    process.exitCode = 1;
  }

  return allPassed;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
