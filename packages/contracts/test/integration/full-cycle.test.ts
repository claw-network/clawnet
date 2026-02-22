/**
 * Full-Cycle Integration Test (T-2.15)
 *
 * End-to-end scenario deploying ALL 8+1 contracts and exercising cross-module flows:
 *   1. Register DID + stake to become validator
 *   2. Create service contract → sign → activate → milestones → complete
 *   3. Record reviews → anchor reputation
 *   4. DAO proposal to modify param → vote → queue → execute → verify
 *   5. Router module registry + multicall
 */
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { keccak256, toUtf8Bytes, ZeroHash } from "ethers";

describe("Full-Cycle Integration: Cross-Module E2E", function () {
  // ─── Contracts ──────────────────────────────────────────────────
  let token: any;
  let escrow: any;
  let identity: any;
  let staking: any;
  let paramRegistry: any;
  let dao: any;
  let contracts: any;
  let reputation: any;
  let router: any;

  // ─── Signers ────────────────────────────────────────────────────
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner; // client
  let bob: HardhatEthersSigner;   // provider / validator
  let carol: HardhatEthersSigner; // voter
  let arbiter: HardhatEthersSigner;
  let signers: HardhatEthersSigner[];

  // ─── Constants ──────────────────────────────────────────────────
  const MIN_STAKE = 10_000;
  const UNSTAKE_COOLDOWN = 604_800; // 7 days
  const EPOCH_DURATION = 86400n; // 24h
  const ESCROW_BASE_RATE = 100;
  const ESCROW_HOLDING_RATE = 5;
  const ESCROW_MIN_FEE = 1;
  const PLATFORM_FEE_BPS = 100; // 1%
  const PROPOSAL_THRESHOLD = 100;
  const DISCUSSION_PERIOD = 60;
  const VOTING_PERIOD = 300;
  const TIMELOCK_DELAY = 60;
  const QUORUM_BPS = 10; // 0.1% — sqrt-based voting power is much smaller than raw supply

  // DID hashes
  const ALICE_DID_HASH = keccak256(toUtf8Bytes("did:claw:alice"));
  const BOB_DID_HASH = keccak256(toUtf8Bytes("did:claw:bob"));

  // ─── Deploy All ─────────────────────────────────────────────────
  before(async function () {
    const allSigners = await ethers.getSigners();
    deployer = allSigners[0];
    alice = allSigners[1];
    bob = allSigners[2];
    carol = allSigners[3];
    arbiter = allSigners[4];
    // Need 9 signers for DAO emergency multisig
    signers = allSigners.slice(5, 14);
    // Pad to 9 if not enough
    while (signers.length < 9) signers.push(allSigners[signers.length + 5] || allSigners[0]);

    // 1. ClawToken
    const TokenF = await ethers.getContractFactory("ClawToken");
    token = await upgrades.deployProxy(
      TokenF,
      ["ClawNet Token", "TOKEN", deployer.address],
      { kind: "uups" }
    );
    await token.waitForDeployment();

    // 2. ParamRegistry
    const ParamF = await ethers.getContractFactory("ParamRegistry");
    paramRegistry = await upgrades.deployProxy(ParamF, [deployer.address], { kind: "uups" });
    await paramRegistry.waitForDeployment();

    // 3. ClawEscrow
    const EscrowF = await ethers.getContractFactory("ClawEscrow");
    escrow = await upgrades.deployProxy(
      EscrowF,
      [await token.getAddress(), deployer.address, ESCROW_BASE_RATE, ESCROW_HOLDING_RATE, ESCROW_MIN_FEE],
      { kind: "uups" }
    );
    await escrow.waitForDeployment();

    // 4. ClawIdentity
    const IdentityF = await ethers.getContractFactory("ClawIdentity");
    identity = await upgrades.deployProxy(IdentityF, [deployer.address], { kind: "uups" });
    await identity.waitForDeployment();

    // 5. ClawStaking
    const StakingF = await ethers.getContractFactory("ClawStaking");
    staking = await upgrades.deployProxy(
      StakingF,
      [await token.getAddress(), MIN_STAKE, UNSTAKE_COOLDOWN, 1, 1],
      { kind: "uups" }
    );
    await staking.waitForDeployment();

    // 6. ClawDAO
    const DaoF = await ethers.getContractFactory("ClawDAO");
    const signerAddrs = signers.map((s) => s.address) as [string, string, string, string, string, string, string, string, string];
    dao = await upgrades.deployProxy(
      DaoF,
      [
        await token.getAddress(),
        await paramRegistry.getAddress(),
        PROPOSAL_THRESHOLD,
        DISCUSSION_PERIOD,
        VOTING_PERIOD,
        TIMELOCK_DELAY,
        QUORUM_BPS,
        signerAddrs,
      ],
      { kind: "uups" }
    );
    await dao.waitForDeployment();

    // 7. ClawContracts
    const ContractsF = await ethers.getContractFactory("ClawContracts");
    contracts = await upgrades.deployProxy(
      ContractsF,
      [await token.getAddress(), deployer.address, PLATFORM_FEE_BPS, deployer.address],
      { kind: "uups" }
    );
    await contracts.waitForDeployment();

    // 8. ClawReputation
    const ReputationF = await ethers.getContractFactory("ClawReputation");
    reputation = await upgrades.deployProxy(
      ReputationF,
      [deployer.address, EPOCH_DURATION],
      { kind: "uups" }
    );
    await reputation.waitForDeployment();

    // 9. ClawRouter
    const RouterF = await ethers.getContractFactory("ClawRouter");
    router = await upgrades.deployProxy(RouterF, [deployer.address], { kind: "uups" });
    await router.waitForDeployment();

    // ── Cross-contract Role Grants ────────────────────────────────
    // Staking needs MINTER_ROLE on Token (for reward distribution)
    const MINTER_ROLE = keccak256(toUtf8Bytes("MINTER_ROLE"));
    await token.grantRole(MINTER_ROLE, await staking.getAddress());

    // DAO needs GOVERNOR_ROLE on ParamRegistry
    const GOVERNOR_ROLE = keccak256(toUtf8Bytes("GOVERNOR_ROLE"));
    await paramRegistry.grantRole(GOVERNOR_ROLE, await dao.getAddress());

    // Set reputation contract on DAO
    await dao.setReputationContract(await reputation.getAddress());

    // Grant ARBITER_ROLE on ClawContracts to arbiter
    const ARBITER_ROLE = keccak256(toUtf8Bytes("ARBITER_ROLE"));
    await contracts.grantRole(ARBITER_ROLE, arbiter.address);

    // ── Mint initial tokens ───────────────────────────────────────
    await token.mint(alice.address, 500_000);
    await token.mint(bob.address, 500_000);
    await token.mint(carol.address, 500_000);
  });

  // ──────────────────────────────────────────────────────────────────
  // Scenario 1: Register DID + Stake to become validator
  // ──────────────────────────────────────────────────────────────────
  describe("Scenario 1: DID Registration + Staking", () => {
    it("registers Alice's DID on ClawIdentity", async () => {
      const pubKey = ethers.randomBytes(32);
      await identity.registerDID(ALICE_DID_HASH, pubKey, 0, alice.address);
      expect(await identity.isActive(ALICE_DID_HASH)).to.be.true;
      expect(await identity.getController(ALICE_DID_HASH)).to.equal(alice.address);
    });

    it("registers Bob's DID on ClawIdentity", async () => {
      const pubKey = ethers.randomBytes(32);
      await identity.registerDID(BOB_DID_HASH, pubKey, 0, bob.address);
      expect(await identity.isActive(BOB_DID_HASH)).to.be.true;
    });

    it("Bob stakes 50,000 Tokens to become a validator", async () => {
      const stakingAddr = await staking.getAddress();
      await token.connect(bob).approve(stakingAddr, 50_000);
      await staking.connect(bob).stake(50_000, 0); // nodeType 0

      expect(await staking.isActiveValidator(bob.address)).to.be.true;
      const info = await staking.getStakeInfo(bob.address);
      expect(info.amount).to.equal(50_000);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Scenario 2: Service Contract lifecycle
  // ──────────────────────────────────────────────────────────────────
  describe("Scenario 2: Service Contract → Milestones → Complete", () => {
    const contractId = keccak256(toUtf8Bytes("contract-001"));
    const milestoneAmounts = [3000, 7000]; // total 10,000
    const termsHash = keccak256(toUtf8Bytes("terms-v1"));

    it("Alice creates a service contract with Bob as provider", async () => {
      const deadline = (await time.latest()) + 86400 * 30;
      const milestoneDeadlines = [deadline - 86400 * 10, deadline];

      await contracts.connect(alice).createContract(
        contractId,
        bob.address,
        arbiter.address,
        10_000,
        termsHash,
        deadline,
        milestoneAmounts,
        milestoneDeadlines
      );

      const info = await contracts.getContract(contractId);
      expect(info.client).to.equal(alice.address);
      expect(info.provider).to.equal(bob.address);
      expect(info.totalAmount).to.equal(10_000);
    });

    it("both parties sign the contract", async () => {
      await contracts.connect(alice).signContract(contractId);
      await contracts.connect(bob).signContract(contractId);
    });

    it("Alice activates the contract (funds are transferred)", async () => {
      const contractsAddr = await contracts.getAddress();
      await token.connect(alice).approve(contractsAddr, 20_000); // enough for amount + fee
      await contracts.connect(alice).activateContract(contractId);
    });

    it("Bob submits milestone 0, Alice approves → funds released", async () => {
      const deliverableHash = keccak256(toUtf8Bytes("deliverable-0"));
      await contracts.connect(bob).submitMilestone(contractId, 0, deliverableHash);

      const bobBefore = await token.balanceOf(bob.address);
      await contracts.connect(alice).approveMilestone(contractId, 0);
      const bobAfter = await token.balanceOf(bob.address);
      expect(bobAfter - bobBefore).to.equal(3000);
    });

    it("Bob submits milestone 1, Alice approves → contract complete", async () => {
      const deliverableHash = keccak256(toUtf8Bytes("deliverable-1"));
      await contracts.connect(bob).submitMilestone(contractId, 1, deliverableHash);
      await contracts.connect(alice).approveMilestone(contractId, 1);

      // All milestones approved → completeContract
      await contracts.connect(alice).completeContract(contractId);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Scenario 3: Review → Reputation Anchoring
  // ──────────────────────────────────────────────────────────────────
  describe("Scenario 3: Review Recording + Reputation Anchoring", () => {
    const reviewHash = keccak256(toUtf8Bytes("review-alice-to-bob"));
    const txHash = keccak256(toUtf8Bytes("contract-001"));

    it("records Alice's review of Bob", async () => {
      await reputation.recordReview(reviewHash, ALICE_DID_HASH, BOB_DID_HASH, txHash);
      const review = await reputation.verifyReview(reviewHash);
      expect(review.reviewerDIDHash).to.equal(ALICE_DID_HASH);
      expect(review.subjectDIDHash).to.equal(BOB_DID_HASH);
    });

    it("anchors Bob's reputation (score 850)", async () => {
      const dims: [number, number, number, number, number] = [900, 800, 850, 800, 900];
      const merkleRoot = keccak256(toUtf8Bytes("merkle-root-bob-epoch0"));
      await reputation.anchorReputation(BOB_DID_HASH, 850, dims, merkleRoot);

      const [score, epoch] = await reputation.getReputation(BOB_DID_HASH);
      expect(score).to.equal(850);
    });

    it("links Bob's address to his DID for DAO trust score", async () => {
      await reputation.linkAddressToDID(bob.address, BOB_DID_HASH);
      expect(await reputation.getTrustScore(bob.address)).to.equal(850);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Scenario 4: DAO Governance — Modify Parameter
  // ──────────────────────────────────────────────────────────────────
  describe("Scenario 4: DAO Proposal → Vote → Execute → Param Changed", () => {
    let proposalId: bigint;
    const ESCROW_BASE_RATE_KEY = keccak256(toUtf8Bytes("ESCROW_BASE_RATE"));

    it("Alice creates a proposal to change ESCROW_BASE_RATE to 200", async () => {
      // Proposal type 0 = ParameterChange
      const descHash = keccak256(toUtf8Bytes("Increase escrow base rate to 2%"));
      const target = await paramRegistry.getAddress();
      const callData = paramRegistry.interface.encodeFunctionData("setParam", [
        ESCROW_BASE_RATE_KEY,
        200,
      ]);

      const tx = await dao.connect(alice).propose(0, descHash, target, callData);
      const receipt = await tx.wait();
      // Find ProposalCreated event
      const event = receipt?.logs.find((log: any) => {
        try {
          return dao.interface.parseLog(log)?.name === "ProposalCreated";
        } catch {
          return false;
        }
      });
      proposalId = dao.interface.parseLog(event)?.args[0];
      expect(proposalId).to.be.gte(0);
    });

    it("waits for discussion period to end, then votes", async () => {
      await time.increase(DISCUSSION_PERIOD + 1);

      // Alice votes for (support=1)
      await dao.connect(alice).vote(proposalId, 1);
      // Bob votes for (with trust score boost)
      await dao.connect(bob).vote(proposalId, 1);
      // Carol votes for
      await dao.connect(carol).vote(proposalId, 1);
    });

    it("waits for voting period to end, then queues", async () => {
      await time.increase(VOTING_PERIOD + 1);
      await dao.queue(proposalId);
    });

    it("waits for timelock, then executes → param updated on-chain", async () => {
      await time.increase(TIMELOCK_DELAY + 1);
      await dao.execute(proposalId);

      // Verify the parameter was actually updated in ParamRegistry
      const newRate = await paramRegistry.getParam(ESCROW_BASE_RATE_KEY);
      expect(newRate).to.equal(200);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Scenario 5: Router Module Registry
  // ──────────────────────────────────────────────────────────────────
  describe("Scenario 5: ClawRouter Module Registry", () => {
    it("registers all 8 contracts in router", async () => {
      const keys = [
        await router.MODULE_TOKEN(),
        await router.MODULE_ESCROW(),
        await router.MODULE_IDENTITY(),
        await router.MODULE_STAKING(),
        await router.MODULE_DAO(),
        await router.MODULE_CONTRACTS(),
        await router.MODULE_REPUTATION(),
        await router.MODULE_PARAM_REGISTRY(),
      ];
      const addrs = [
        await token.getAddress(),
        await escrow.getAddress(),
        await identity.getAddress(),
        await staking.getAddress(),
        await dao.getAddress(),
        await contracts.getAddress(),
        await reputation.getAddress(),
        await paramRegistry.getAddress(),
      ];

      await router.batchRegisterModules(keys, addrs);
      expect(await router.moduleCount()).to.equal(8);
    });

    it("can look up any module by key", async () => {
      const tokenKey = await router.MODULE_TOKEN();
      expect(await router.getModule(tokenKey)).to.equal(await token.getAddress());

      const daoKey = await router.MODULE_DAO();
      expect(await router.getModule(daoKey)).to.equal(await dao.getAddress());
    });

    it("getAllModules returns all 8 entries", async () => {
      const [keys, addrs] = await router.getAllModules();
      expect(keys.length).to.equal(8);
      expect(addrs.length).to.equal(8);
    });
  });
});
