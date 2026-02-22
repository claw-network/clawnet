/**
 * CLI on-chain commands — interact with ClawNet smart contracts directly.
 *
 * Usage:
 *   clawnet onchain dao propose|vote|queue|execute|cancel [options]
 *   clawnet onchain stake|unstake|claim-rewards [options]
 *   clawnet onchain contract create|sign|activate|complete|milestone-submit|milestone-approve|dispute|resolve [options]
 *   clawnet onchain reputation anchor|review|link|trust-score|info [options]
 *   clawnet onchain balance [options]
 *
 * Common on-chain options:
 *   --rpc <url>              JSON-RPC endpoint (default: http://127.0.0.1:8545, or env CLAW_RPC_URL)
 *   --private-key <hex>      Private key hex (or env CLAW_PRIVATE_KEY)
 *   --passphrase <text>      Decrypt local keystore instead of --private-key
 *   --key-id <id>            Key record id in keystore
 *   --data-dir <path>        Override storage root (for keystore)
 *
 * Contract address env variables:
 *   CLAW_TOKEN_ADDRESS, CLAW_IDENTITY_ADDRESS, CLAW_ESCROW_ADDRESS,
 *   CLAW_STAKING_ADDRESS, CLAW_REPUTATION_ADDRESS, CLAW_DAO_ADDRESS,
 *   CLAW_CONTRACTS_ADDRESS, CLAW_PARAM_REGISTRY_ADDRESS, CLAW_ROUTER_ADDRESS
 */

// NOTE: ethers is a peer/optional dependency. We import it dynamically
// so the CLI doesn't crash if ethers is not installed (non-onchain users).
// The SDK on-chain adapters re-export the necessary types.

// ---------------------------------------------------------------------------
// Types for parsed args
// ---------------------------------------------------------------------------

interface OnChainBaseArgs {
  rpc: string;
  privateKey?: string;
  passphrase?: string;
  keyId: string;
  dataDir?: string;
}

interface ContractAddresses {
  token: string;
  identity: string;
  escrow: string;
  staking: string;
  reputation: string;
  dao: string;
  contracts: string;
  paramRegistry: string;
  router: string;
}

// ---------------------------------------------------------------------------
// Arg parsing helpers
// ---------------------------------------------------------------------------

function parseOnChainBaseArgs(rawArgs: string[]): OnChainBaseArgs {
  let rpc = process.env['CLAW_RPC_URL'] ?? 'http://127.0.0.1:8545';
  let privateKey = process.env['CLAW_PRIVATE_KEY'];
  let passphrase: string | undefined;
  let keyId = 'default';
  let dataDir: string | undefined;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--rpc' && rawArgs[i + 1]) { rpc = rawArgs[++i]!; continue; }
    if (arg === '--private-key' && rawArgs[i + 1]) { privateKey = rawArgs[++i]!; continue; }
    if (arg === '--passphrase' && rawArgs[i + 1]) { passphrase = rawArgs[++i]; continue; }
    if (arg === '--key-id' && rawArgs[i + 1]) { keyId = rawArgs[++i]!; continue; }
    if (arg === '--data-dir' && rawArgs[i + 1]) { dataDir = rawArgs[++i]; continue; }
  }

  return { rpc, privateKey, passphrase, keyId, dataDir };
}

function getAddresses(): ContractAddresses {
  return {
    token:         requireEnv('CLAW_TOKEN_ADDRESS', '--token-address'),
    identity:      process.env['CLAW_IDENTITY_ADDRESS'] ?? '',
    escrow:        process.env['CLAW_ESCROW_ADDRESS'] ?? '',
    staking:       requireEnv('CLAW_STAKING_ADDRESS', '--staking-address'),
    reputation:    requireEnv('CLAW_REPUTATION_ADDRESS', '--reputation-address'),
    dao:           requireEnv('CLAW_DAO_ADDRESS', '--dao-address'),
    contracts:     requireEnv('CLAW_CONTRACTS_ADDRESS', '--contracts-address'),
    paramRegistry: process.env['CLAW_PARAM_REGISTRY_ADDRESS'] ?? '',
    router:        process.env['CLAW_ROUTER_ADDRESS'] ?? '',
  };
}

function requireEnv(envName: string, _flagHint: string): string {
  const val = process.env[envName];
  if (!val) {
    fail(`missing ${envName} environment variable`);
  }
  return val;
}

function getNamedArg(rawArgs: string[], name: string): string | undefined {
  const idx = rawArgs.indexOf(name);
  if (idx === -1 || idx + 1 >= rawArgs.length) return undefined;
  return rawArgs[idx + 1];
}

function requireNamedArg(rawArgs: string[], name: string, label: string): string {
  const val = getNamedArg(rawArgs, name);
  if (!val) fail(`missing required ${label} (${name})`);
  return val;
}

// ---------------------------------------------------------------------------
// Signer setup (dynamic import of ethers)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createSigner(base: OnChainBaseArgs): Promise<any> {
  const ethers = await import('ethers' /* webpackIgnore: true */);
  const provider = new ethers.JsonRpcProvider(base.rpc);

  if (base.privateKey) {
    return new ethers.Wallet(base.privateKey, provider);
  }

  // Fallback: load from local keystore
  if (base.passphrase) {
    const core = await import('@claw-network/core');
    const paths = core.resolveStoragePaths(base.dataDir);
    const record = await core.loadKeyRecord(paths, base.keyId);
    const privBytes = await Promise.resolve(core.decryptKeyRecord(record, base.passphrase));
    const hexKey = Array.from(new Uint8Array(privBytes))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return new ethers.Wallet(`0x${hexKey}`, provider);
  }

  fail('provide --private-key or --passphrase to sign transactions');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createProvider(rpc: string): Promise<any> {
  const ethers = await import('ethers' /* webpackIgnore: true */);
  return new ethers.JsonRpcProvider(rpc);
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

export async function runOnChain(argv: string[]): Promise<void> {
  const subcommand = argv[0];
  const subArgs = argv.slice(1);

  if (subcommand === 'dao') {
    await dispatchDao(subArgs);
    return;
  }

  if (subcommand === 'stake' || subcommand === 'unstake' || subcommand === 'claim-rewards') {
    await dispatchStaking([subcommand, ...subArgs]);
    return;
  }

  if (subcommand === 'contract') {
    await dispatchContract(subArgs);
    return;
  }

  if (subcommand === 'reputation') {
    await dispatchReputation(subArgs);
    return;
  }

  if (subcommand === 'balance') {
    await runOnChainBalance(subArgs);
    return;
  }

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printOnChainHelp();
    return;
  }

  fail(`unknown onchain subcommand: ${subcommand ?? ''}\nRun: clawnet onchain help`);
}

// ---------------------------------------------------------------------------
// DAO commands
// ---------------------------------------------------------------------------

async function dispatchDao(args: string[]): Promise<void> {
  const action = args[0];
  const actionArgs = args.slice(1);

  if (action === 'propose') { await runDaoPropose(actionArgs); return; }
  if (action === 'vote') { await runDaoVote(actionArgs); return; }
  if (action === 'queue') { await runDaoQueue(actionArgs); return; }
  if (action === 'execute') { await runDaoExecute(actionArgs); return; }
  if (action === 'cancel') { await runDaoCancel(actionArgs); return; }
  if (action === 'proposal') { await runDaoGetProposal(actionArgs); return; }
  if (action === 'status') { await runDaoGetStatus(actionArgs); return; }

  fail(`unknown onchain dao action: ${action ?? ''}`);
}

async function runDaoPropose(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { DaoOnChainApi, ProposalType } = await import('@claw-network/sdk');
  const dao = new DaoOnChainApi(signer, { daoAddress: addrs.dao });

  const pType = requireNamedArg(args, '--type', 'proposal type (0–4 or name)');
  const descHash = requireNamedArg(args, '--desc-hash', 'description hash (bytes32)');
  const target = getNamedArg(args, '--target') ?? '0x0000000000000000000000000000000000000000';
  const calldata = getNamedArg(args, '--calldata') ?? '0x';

  // Parse proposal type: can be number or name
  let proposalTypeNum: number;
  const typeNames: Record<string, number> = {
    parameter: ProposalType.ParameterChange,
    treasury: ProposalType.TreasurySpend,
    upgrade: ProposalType.ContractUpgrade,
    signal: ProposalType.Signal,
    emergency: ProposalType.Emergency,
  };
  const lower = pType.toLowerCase();
  proposalTypeNum = typeNames[lower] !== undefined ? typeNames[lower]! : Number(pType);

  if (isNaN(proposalTypeNum) || proposalTypeNum < 0 || proposalTypeNum > 4) {
    fail('invalid --type: must be 0–4 or parameter|treasury|upgrade|signal|emergency');
  }

  const result = await dao.propose(proposalTypeNum, descHash, target, calldata);
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoVote(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { DaoOnChainApi, VoteSupport } = await import('@claw-network/sdk');
  const dao = new DaoOnChainApi(signer, { daoAddress: addrs.dao });

  const proposalId = Number(requireNamedArg(args, '--proposal-id', 'proposal ID'));
  const supportStr = requireNamedArg(args, '--support', 'vote support (for|against|abstain or 0|1|2)');

  const supportNames: Record<string, number> = {
    for: VoteSupport.For,
    against: VoteSupport.Against,
    abstain: VoteSupport.Abstain,
  };
  const lower = supportStr.toLowerCase();
  const support = supportNames[lower] !== undefined ? supportNames[lower]! : Number(supportStr);

  if (isNaN(support) || support < 0 || support > 2) {
    fail('invalid --support: must be for|against|abstain or 0|1|2');
  }

  const result = await dao.vote(proposalId, support);
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoQueue(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { DaoOnChainApi } = await import('@claw-network/sdk');
  const dao = new DaoOnChainApi(signer, { daoAddress: addrs.dao });

  const proposalId = Number(requireNamedArg(args, '--proposal-id', 'proposal ID'));
  const result = await dao.queue(proposalId);
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoExecute(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { DaoOnChainApi } = await import('@claw-network/sdk');
  const dao = new DaoOnChainApi(signer, { daoAddress: addrs.dao });

  const proposalId = Number(requireNamedArg(args, '--proposal-id', 'proposal ID'));
  const result = await dao.execute(proposalId);
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoCancel(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { DaoOnChainApi } = await import('@claw-network/sdk');
  const dao = new DaoOnChainApi(signer, { daoAddress: addrs.dao });

  const proposalId = Number(requireNamedArg(args, '--proposal-id', 'proposal ID'));
  const result = await dao.cancel(proposalId);
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoGetProposal(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const provider = await createProvider(base.rpc);

  const { DaoOnChainApi } = await import('@claw-network/sdk');
  const dao = DaoOnChainApi.readOnly(provider, { daoAddress: addrs.dao });

  const proposalId = Number(requireNamedArg(args, '--proposal-id', 'proposal ID'));
  const proposal = await dao.getProposal(proposalId);
  console.log(JSON.stringify(proposal, null, 2));
}

async function runDaoGetStatus(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const provider = await createProvider(base.rpc);

  const { DaoOnChainApi } = await import('@claw-network/sdk');
  const dao = DaoOnChainApi.readOnly(provider, { daoAddress: addrs.dao });

  const proposalId = Number(requireNamedArg(args, '--proposal-id', 'proposal ID'));
  const status = await dao.getStatus(proposalId);
  const statusNames = ['Pending', 'Active', 'Passed', 'Failed', 'Queued', 'Executed', 'Cancelled', 'Expired'];
  console.log(JSON.stringify({ proposalId, status, statusName: statusNames[status] ?? 'Unknown' }, null, 2));
}

// ---------------------------------------------------------------------------
// Staking commands
// ---------------------------------------------------------------------------

async function dispatchStaking(args: string[]): Promise<void> {
  const action = args[0];
  const actionArgs = args.slice(1);

  if (action === 'stake') { await runStake(actionArgs); return; }
  if (action === 'unstake') { await runUnstake(actionArgs); return; }
  if (action === 'request-unstake') { await runRequestUnstake(actionArgs); return; }
  if (action === 'claim-rewards') { await runClaimRewards(actionArgs); return; }
  if (action === 'info') { await runStakeInfo(actionArgs); return; }
  if (action === 'validators') { await runValidators(actionArgs); return; }

  fail(`unknown staking action: ${action ?? ''}`);
}

async function runStake(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { StakingOnChainApi, NodeType } = await import('@claw-network/sdk');
  const staking = new StakingOnChainApi(signer, {
    stakingAddress: addrs.staking,
    tokenAddress: addrs.token,
  });

  const amount = Number(requireNamedArg(args, '--amount', 'stake amount (Tokens)'));
  const nodeTypeStr = getNamedArg(args, '--node-type') ?? '0';

  const nodeTypeNames: Record<string, number> = {
    full: NodeType.Full,
    validator: NodeType.Validator,
    archive: NodeType.Archive,
    light: NodeType.Light,
    gateway: NodeType.Gateway,
  };
  const lower = nodeTypeStr.toLowerCase();
  const nodeType = nodeTypeNames[lower] !== undefined ? nodeTypeNames[lower]! : Number(nodeTypeStr);

  const result = await staking.stake(amount, nodeType);
  console.log(JSON.stringify(result, null, 2));
}

async function runRequestUnstake(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { StakingOnChainApi } = await import('@claw-network/sdk');
  const staking = new StakingOnChainApi(signer, {
    stakingAddress: addrs.staking,
    tokenAddress: addrs.token,
  });

  const result = await staking.requestUnstake();
  console.log(JSON.stringify(result, null, 2));
}

async function runUnstake(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { StakingOnChainApi } = await import('@claw-network/sdk');
  const staking = new StakingOnChainApi(signer, {
    stakingAddress: addrs.staking,
    tokenAddress: addrs.token,
  });

  const result = await staking.unstake();
  console.log(JSON.stringify(result, null, 2));
}

async function runClaimRewards(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { StakingOnChainApi } = await import('@claw-network/sdk');
  const staking = new StakingOnChainApi(signer, {
    stakingAddress: addrs.staking,
    tokenAddress: addrs.token,
  });

  const result = await staking.claimRewards();
  console.log(JSON.stringify(result, null, 2));
}

async function runStakeInfo(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const provider = await createProvider(base.rpc);

  const { StakingOnChainApi } = await import('@claw-network/sdk');
  const staking = StakingOnChainApi.readOnly(provider, {
    stakingAddress: addrs.staking,
    tokenAddress: addrs.token,
  });

  const account = requireNamedArg(args, '--account', 'account address');
  const info = await staking.getStakeInfo(account);
  console.log(JSON.stringify(info, null, 2));
}

async function runValidators(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const provider = await createProvider(base.rpc);

  const { StakingOnChainApi } = await import('@claw-network/sdk');
  const staking = StakingOnChainApi.readOnly(provider, {
    stakingAddress: addrs.staking,
    tokenAddress: addrs.token,
  });

  const validators = await staking.getActiveValidators();
  const count = await staking.activeValidatorCount();
  console.log(JSON.stringify({ count, validators }, null, 2));
}

// ---------------------------------------------------------------------------
// Contract commands
// ---------------------------------------------------------------------------

async function dispatchContract(args: string[]): Promise<void> {
  const action = args[0];
  const actionArgs = args.slice(1);

  if (action === 'create') { await runContractCreate(actionArgs); return; }
  if (action === 'sign') { await runContractSign(actionArgs); return; }
  if (action === 'activate') { await runContractActivate(actionArgs); return; }
  if (action === 'complete') { await runContractComplete(actionArgs); return; }
  if (action === 'cancel') { await runContractCancel(actionArgs); return; }
  if (action === 'milestone-submit') { await runMilestoneSubmit(actionArgs); return; }
  if (action === 'milestone-approve') { await runMilestoneApprove(actionArgs); return; }
  if (action === 'milestone-reject') { await runMilestoneReject(actionArgs); return; }
  if (action === 'dispute') { await runContractDispute(actionArgs); return; }
  if (action === 'resolve') { await runContractResolve(actionArgs); return; }
  if (action === 'get') { await runContractGet(actionArgs); return; }
  if (action === 'fee') { await runContractFee(actionArgs); return; }

  fail(`unknown onchain contract action: ${action ?? ''}`);
}

async function runContractCreate(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { ContractsOnChainApi } = await import('@claw-network/sdk');
  const contracts = new ContractsOnChainApi(signer, {
    contractsAddress: addrs.contracts,
    tokenAddress: addrs.token,
  });

  const contractId = requireNamedArg(args, '--id', 'contract ID (bytes32)');
  const provider = requireNamedArg(args, '--provider', 'provider address');
  const arbiter = requireNamedArg(args, '--arbiter', 'arbiter address');
  const amount = Number(requireNamedArg(args, '--amount', 'amount (Tokens)'));
  const termsHash = requireNamedArg(args, '--terms-hash', 'terms hash (bytes32)');
  const deadline = Number(requireNamedArg(args, '--deadline', 'deadline (unix timestamp)'));

  // Parse milestones: --milestones '[100,200]' --milestone-deadlines '[1700000,1800000]'
  const milestonesJson = getNamedArg(args, '--milestones') ?? '[]';
  const deadlinesJson = getNamedArg(args, '--milestone-deadlines') ?? '[]';

  let milestoneAmounts: number[];
  let milestoneDeadlines: number[];
  try {
    milestoneAmounts = JSON.parse(milestonesJson);
    milestoneDeadlines = JSON.parse(deadlinesJson);
  } catch {
    fail('invalid --milestones or --milestone-deadlines: must be JSON arrays');
    return; // unreachable but TS wants it
  }

  const result = await contracts.createContract(
    contractId, provider, arbiter, amount, termsHash, deadline,
    milestoneAmounts, milestoneDeadlines,
  );
  console.log(JSON.stringify(result, null, 2));
}

async function runContractSign(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { ContractsOnChainApi } = await import('@claw-network/sdk');
  const contracts = new ContractsOnChainApi(signer, {
    contractsAddress: addrs.contracts,
    tokenAddress: addrs.token,
  });

  const contractId = requireNamedArg(args, '--id', 'contract ID (bytes32)');
  const result = await contracts.signContract(contractId);
  console.log(JSON.stringify(result, null, 2));
}

async function runContractActivate(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { ContractsOnChainApi } = await import('@claw-network/sdk');
  const contracts = new ContractsOnChainApi(signer, {
    contractsAddress: addrs.contracts,
    tokenAddress: addrs.token,
  });

  const contractId = requireNamedArg(args, '--id', 'contract ID (bytes32)');
  const result = await contracts.activateContract(contractId);
  console.log(JSON.stringify(result, null, 2));
}

async function runContractComplete(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { ContractsOnChainApi } = await import('@claw-network/sdk');
  const contracts = new ContractsOnChainApi(signer, {
    contractsAddress: addrs.contracts,
    tokenAddress: addrs.token,
  });

  const contractId = requireNamedArg(args, '--id', 'contract ID (bytes32)');
  const result = await contracts.completeContract(contractId);
  console.log(JSON.stringify(result, null, 2));
}

async function runContractCancel(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { ContractsOnChainApi } = await import('@claw-network/sdk');
  const contracts = new ContractsOnChainApi(signer, {
    contractsAddress: addrs.contracts,
    tokenAddress: addrs.token,
  });

  const contractId = requireNamedArg(args, '--id', 'contract ID (bytes32)');
  const result = await contracts.cancelContract(contractId);
  console.log(JSON.stringify(result, null, 2));
}

async function runMilestoneSubmit(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { ContractsOnChainApi } = await import('@claw-network/sdk');
  const contracts = new ContractsOnChainApi(signer, {
    contractsAddress: addrs.contracts,
    tokenAddress: addrs.token,
  });

  const contractId = requireNamedArg(args, '--id', 'contract ID (bytes32)');
  const index = Number(requireNamedArg(args, '--index', 'milestone index'));
  const evidenceHash = requireNamedArg(args, '--evidence-hash', 'evidence hash (bytes32)');
  const result = await contracts.submitMilestone(contractId, index, evidenceHash);
  console.log(JSON.stringify(result, null, 2));
}

async function runMilestoneApprove(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { ContractsOnChainApi } = await import('@claw-network/sdk');
  const contracts = new ContractsOnChainApi(signer, {
    contractsAddress: addrs.contracts,
    tokenAddress: addrs.token,
  });

  const contractId = requireNamedArg(args, '--id', 'contract ID (bytes32)');
  const index = Number(requireNamedArg(args, '--index', 'milestone index'));
  const result = await contracts.approveMilestone(contractId, index);
  console.log(JSON.stringify(result, null, 2));
}

async function runMilestoneReject(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { ContractsOnChainApi } = await import('@claw-network/sdk');
  const contracts = new ContractsOnChainApi(signer, {
    contractsAddress: addrs.contracts,
    tokenAddress: addrs.token,
  });

  const contractId = requireNamedArg(args, '--id', 'contract ID (bytes32)');
  const index = Number(requireNamedArg(args, '--index', 'milestone index'));
  const reason = requireNamedArg(args, '--reason', 'rejection reason (bytes32)');
  const result = await contracts.rejectMilestone(contractId, index, reason);
  console.log(JSON.stringify(result, null, 2));
}

async function runContractDispute(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { ContractsOnChainApi } = await import('@claw-network/sdk');
  const contracts = new ContractsOnChainApi(signer, {
    contractsAddress: addrs.contracts,
    tokenAddress: addrs.token,
  });

  const contractId = requireNamedArg(args, '--id', 'contract ID (bytes32)');
  const reason = requireNamedArg(args, '--reason', 'dispute reason (bytes32)');
  const result = await contracts.disputeContract(contractId, reason);
  console.log(JSON.stringify(result, null, 2));
}

async function runContractResolve(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { ContractsOnChainApi, DisputeResolution } = await import('@claw-network/sdk');
  const contracts = new ContractsOnChainApi(signer, {
    contractsAddress: addrs.contracts,
    tokenAddress: addrs.token,
  });

  const contractId = requireNamedArg(args, '--id', 'contract ID (bytes32)');
  const resStr = requireNamedArg(args, '--resolution', 'resolution (client|provider|split or 0|1|2)');

  const resNames: Record<string, number> = {
    client: DisputeResolution.ClientFavored,
    provider: DisputeResolution.ProviderFavored,
    split: DisputeResolution.Split,
  };
  const lower = resStr.toLowerCase();
  const resolution = resNames[lower] !== undefined ? resNames[lower]! : Number(resStr);

  const result = await contracts.resolveDispute(contractId, resolution);
  console.log(JSON.stringify(result, null, 2));
}

async function runContractGet(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const provider = await createProvider(base.rpc);

  const { ContractsOnChainApi } = await import('@claw-network/sdk');
  const contracts = ContractsOnChainApi.readOnly(provider, {
    contractsAddress: addrs.contracts,
    tokenAddress: addrs.token,
  });

  const contractId = requireNamedArg(args, '--id', 'contract ID (bytes32)');
  const info = await contracts.getContract(contractId);
  console.log(JSON.stringify(info, null, 2));
}

async function runContractFee(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const provider = await createProvider(base.rpc);

  const { ContractsOnChainApi } = await import('@claw-network/sdk');
  const contracts = ContractsOnChainApi.readOnly(provider, {
    contractsAddress: addrs.contracts,
    tokenAddress: addrs.token,
  });

  const amount = Number(requireNamedArg(args, '--amount', 'contract amount (Tokens)'));
  const fee = await contracts.calculateFee(amount);
  console.log(JSON.stringify({ amount, fee }, null, 2));
}

// ---------------------------------------------------------------------------
// Reputation commands
// ---------------------------------------------------------------------------

async function dispatchReputation(args: string[]): Promise<void> {
  const action = args[0];
  const actionArgs = args.slice(1);

  if (action === 'anchor') { await runReputationAnchor(actionArgs); return; }
  if (action === 'review') { await runReputationReview(actionArgs); return; }
  if (action === 'link') { await runReputationLink(actionArgs); return; }
  if (action === 'trust-score') { await runReputationTrustScore(actionArgs); return; }
  if (action === 'info') { await runReputationInfo(actionArgs); return; }
  if (action === 'epoch') { await runReputationEpoch(actionArgs); return; }

  fail(`unknown onchain reputation action: ${action ?? ''}`);
}

async function runReputationAnchor(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { ReputationOnChainApi } = await import('@claw-network/sdk');
  const rep = new ReputationOnChainApi(signer, { reputationAddress: addrs.reputation });

  const didHash = requireNamedArg(args, '--did-hash', 'agent DID hash (bytes32)');
  const score = Number(requireNamedArg(args, '--score', 'overall score (0–1000)'));
  const dimStr = requireNamedArg(args, '--dimensions', 'dimension scores JSON array [5 items]');
  const merkleRoot = requireNamedArg(args, '--merkle-root', 'merkle root (bytes32)');

  let dimensions: [number, number, number, number, number];
  try {
    const parsed = JSON.parse(dimStr);
    if (!Array.isArray(parsed) || parsed.length !== 5) {
      fail('--dimensions must be a JSON array with exactly 5 numbers');
    }
    dimensions = parsed as [number, number, number, number, number];
  } catch {
    fail('invalid --dimensions: must be JSON array');
    return;
  }

  const result = await rep.anchorReputation(didHash, score, dimensions, merkleRoot);
  console.log(JSON.stringify(result, null, 2));
}

async function runReputationReview(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { ReputationOnChainApi } = await import('@claw-network/sdk');
  const rep = new ReputationOnChainApi(signer, { reputationAddress: addrs.reputation });

  const reviewHash = requireNamedArg(args, '--review-hash', 'review hash (bytes32)');
  const reviewerHash = requireNamedArg(args, '--reviewer-hash', 'reviewer DID hash (bytes32)');
  const subjectHash = requireNamedArg(args, '--subject-hash', 'subject DID hash (bytes32)');
  const txHash = requireNamedArg(args, '--tx-hash', 'transaction hash (bytes32)');

  const result = await rep.recordReview(reviewHash, reviewerHash, subjectHash, txHash);
  console.log(JSON.stringify(result, null, 2));
}

async function runReputationLink(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const signer = await createSigner(base);

  const { ReputationOnChainApi } = await import('@claw-network/sdk');
  const rep = new ReputationOnChainApi(signer, { reputationAddress: addrs.reputation });

  const account = requireNamedArg(args, '--account', 'EVM address');
  const didHash = requireNamedArg(args, '--did-hash', 'agent DID hash (bytes32)');

  const result = await rep.linkAddressToDID(account, didHash);
  console.log(JSON.stringify(result, null, 2));
}

async function runReputationTrustScore(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const provider = await createProvider(base.rpc);

  const { ReputationOnChainApi } = await import('@claw-network/sdk');
  const rep = ReputationOnChainApi.readOnly(provider, { reputationAddress: addrs.reputation });

  const account = requireNamedArg(args, '--account', 'EVM address');
  const score = await rep.getTrustScore(account);
  console.log(JSON.stringify({ account, trustScore: score }, null, 2));
}

async function runReputationInfo(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const provider = await createProvider(base.rpc);

  const { ReputationOnChainApi } = await import('@claw-network/sdk');
  const rep = ReputationOnChainApi.readOnly(provider, { reputationAddress: addrs.reputation });

  const didHash = requireNamedArg(args, '--did-hash', 'agent DID hash (bytes32)');
  const summary = await rep.getReputation(didHash);
  const snapshot = await rep.getLatestSnapshot(didHash);
  console.log(JSON.stringify({ summary, snapshot }, null, 2));
}

async function runReputationEpoch(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const provider = await createProvider(base.rpc);

  const { ReputationOnChainApi } = await import('@claw-network/sdk');
  const rep = ReputationOnChainApi.readOnly(provider, { reputationAddress: addrs.reputation });

  const epoch = await rep.getCurrentEpoch();
  const total = await rep.totalAgents();
  console.log(JSON.stringify({ currentEpoch: epoch, totalAgents: total }, null, 2));
}

// ---------------------------------------------------------------------------
// Balance command
// ---------------------------------------------------------------------------

async function runOnChainBalance(args: string[]): Promise<void> {
  const base = parseOnChainBaseArgs(args);
  const addrs = getAddresses();
  const provider = await createProvider(base.rpc);

  const { WalletOnChainApi } = await import('@claw-network/sdk');
  const wallet = WalletOnChainApi.readOnly(provider, {
    tokenAddress: addrs.token,
    escrowAddress: addrs.escrow,
  });

  // If --account is given use that, otherwise use signer's address
  let account = getNamedArg(args, '--account');
  if (!account) {
    if (!base.privateKey && !base.passphrase) {
      fail('provide --account or --private-key / --passphrase to determine address');
    }
    const signer = await createSigner(base);
    account = await signer.getAddress();
  }

  const balance = await wallet.getBalance(account);
  console.log(JSON.stringify({ account, balance: `${balance} Token` }, null, 2));
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printOnChainHelp(): void {
  console.log(`
clawnet onchain — Interact with ClawNet smart contracts directly.

Usage:
  clawnet onchain dao propose|vote|queue|execute|cancel|proposal|status [options]
  clawnet onchain stake|unstake|request-unstake|claim-rewards|info|validators [options]
  clawnet onchain contract create|sign|activate|complete|cancel|milestone-submit|milestone-approve|milestone-reject|dispute|resolve|get|fee [options]
  clawnet onchain reputation anchor|review|link|trust-score|info|epoch [options]
  clawnet onchain balance [options]

Common options:
  --rpc <url>              JSON-RPC endpoint (default: $CLAW_RPC_URL or http://127.0.0.1:8545)
  --private-key <hex>      Private key (or env CLAW_PRIVATE_KEY)
  --passphrase <text>      Decrypt local keystore
  --key-id <id>            Key record id (default: "default")
  --data-dir <path>        Override storage root

Contract addresses (environment variables):
  CLAW_TOKEN_ADDRESS, CLAW_STAKING_ADDRESS, CLAW_REPUTATION_ADDRESS,
  CLAW_DAO_ADDRESS, CLAW_CONTRACTS_ADDRESS, CLAW_ESCROW_ADDRESS

DAO commands:
  propose   --type <0-4|name> --desc-hash <bytes32> [--target <addr>] [--calldata <hex>]
  vote      --proposal-id <n> --support <for|against|abstain>
  queue     --proposal-id <n>
  execute   --proposal-id <n>
  cancel    --proposal-id <n>
  proposal  --proposal-id <n>  (read-only)
  status    --proposal-id <n>  (read-only)

Staking commands:
  stake           --amount <n> [--node-type <0-4|name>]
  request-unstake
  unstake
  claim-rewards
  info            --account <addr>  (read-only)
  validators                        (read-only)

Contract commands:
  create           --id <bytes32> --provider <addr> --arbiter <addr> --amount <n>
                   --terms-hash <bytes32> --deadline <unix> [--milestones <json>]
                   [--milestone-deadlines <json>]
  sign             --id <bytes32>
  activate         --id <bytes32>
  complete         --id <bytes32>
  cancel           --id <bytes32>
  milestone-submit --id <bytes32> --index <n> --evidence-hash <bytes32>
  milestone-approve --id <bytes32> --index <n>
  milestone-reject --id <bytes32> --index <n> --reason <bytes32>
  dispute          --id <bytes32> --reason <bytes32>
  resolve          --id <bytes32> --resolution <client|provider|split>
  get              --id <bytes32>  (read-only)
  fee              --amount <n>    (read-only)

Reputation commands:
  anchor      --did-hash <bytes32> --score <0-1000> --dimensions <json[5]> --merkle-root <bytes32>
  review      --review-hash <bytes32> --reviewer-hash <bytes32> --subject-hash <bytes32> --tx-hash <bytes32>
  link        --account <addr> --did-hash <bytes32>
  trust-score --account <addr>  (read-only)
  info        --did-hash <bytes32>  (read-only)
  epoch                         (read-only)

Balance:
  balance     [--account <addr>]  (read-only)
`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(`[clawnet onchain] ${message}`);
  process.exit(1);
}
