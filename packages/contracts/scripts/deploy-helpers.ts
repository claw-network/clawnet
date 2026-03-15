import { ethers, upgrades } from "hardhat";
import type { BaseContract, ContractFactory } from "ethers";

/**
 * Deploy a UUPS-upgradeable proxy + implementation contract.
 *
 * @param contractName  The Solidity contract name (e.g. "ClawToken").
 * @param initArgs      Arguments forwarded to the `initialize(...)` function.
 * @returns The proxy contract instance (typed as the implementation ABI).
 */
export async function deployProxy<T extends BaseContract>(
  contractName: string,
  initArgs: unknown[],
): Promise<T> {
  const Factory: ContractFactory = await ethers.getContractFactory(contractName);
  const proxy = await upgrades.deployProxy(Factory, initArgs, {
    kind: "uups",
    initializer: "initialize",
  });
  await proxy.waitForDeployment();
  return proxy as unknown as T;
}

/**
 * Upgrade an existing UUPS proxy to a new implementation.
 *
 * @param proxyAddress    Address of the deployed proxy.
 * @param newContractName The Solidity contract name of the new implementation.
 * @returns The upgraded proxy instance.
 */
export async function upgradeProxy<T extends BaseContract>(
  proxyAddress: string,
  newContractName: string,
): Promise<T> {
  const Factory: ContractFactory = await ethers.getContractFactory(newContractName);
  const upgraded = await upgrades.upgradeProxy(proxyAddress, Factory, {
    kind: "uups",
  });
  await upgraded.waitForDeployment();
  return upgraded as unknown as T;
}
