import hre from "hardhat";

const MESSAGE = "0x0303030303030303030303030303030303030303030303030303030303030303";
const PUBLIC_KEY = "0xea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
const SIGNATURE = "0x47d8693b0cafc1845decc1093ea317b814c9cad0bc02329d5765c3c95d96a54b3866f1c120b04579a8f5e9c1b0ac63db51561f2b7d1f64eb3c35dda329a4b004";

function mutateSignature(signature: string): string {
  const lastByte = signature.slice(-2).toLowerCase() === "04" ? "05" : "04";
  return `${signature.slice(0, -2)}${lastByte}`;
}

async function main() {
  const { ethers, network } = hre;
  const Factory = await ethers.getContractFactory("Ed25519VerifierHarness");
  const harness = await Factory.deploy();
  await harness.waitForDeployment();

  const valid = await harness.verify(MESSAGE, SIGNATURE, PUBLIC_KEY);
  if (!valid) {
    throw new Error(`Expected valid Ed25519 signature on network ${network.name}`);
  }

  const invalid = await harness.verify(MESSAGE, mutateSignature(SIGNATURE), PUBLIC_KEY);
  if (invalid) {
    throw new Error(`Expected tampered Ed25519 signature to fail on network ${network.name}`);
  }

  console.log(
    JSON.stringify(
      {
        network: network.name,
        harness: await harness.getAddress(),
        valid,
        invalid,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});