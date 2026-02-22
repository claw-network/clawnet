/**
 * P0 On-Chain Integration Tests
 *
 * End-to-end scenarios that deploy the full P0 contract suite and verify
 * cross-contract interactions work correctly.
 *
 * Scenarios:
 *   1. Deploy all P0 contracts (ClawToken, ClawEscrow, ClawIdentity, ClawStaking)
 *   2. Register DID on-chain
 *   3. Mint + transfer tokens
 *   4. Create escrow → release → verify balances
 *   5. Stake → query → request unstake
 */
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("P0 Integration: Full On-Chain Flow", function () {
  // Contracts
  let token: any;
  let escrow: any;
  let identity: any;
  let staking: any;

  // Signers
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let arbiter: HardhatEthersSigner;

  // Addresses
  let tokenAddr: string;
  let escrowAddr: string;
  let identityAddr: string;
  let stakingAddr: string;

  // Constants
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const ESCROW_BASE_RATE = 100;   // 1%
  const ESCROW_HOLDING_RATE = 5;  // 0.05% / day
  const ESCROW_MIN_FEE = 1;
  const MIN_STAKE = 10_000;
  const UNSTAKE_COOLDOWN = 604_800; // 7 days
  const REWARD_PER_EPOCH = 1;
  const SLASH_PER_VIOLATION = 1;

  // -----------------------------------------------------------------------
  // Scenario 1: Deploy all P0 contracts
  // -----------------------------------------------------------------------
  before(async function () {
    [deployer, alice, bob, arbiter] = await ethers.getSigners();

    // 1. ClawToken
    const TokenFactory = await ethers.getContractFactory("ClawToken");
    token = await upgrades.deployProxy(
      TokenFactory,
      ["ClawNet Token", "TOKEN", deployer.address],
      { kind: "uups", initializer: "initialize" },
    );
    await token.waitForDeployment();
    tokenAddr = await token.getAddress();

    // 2. ClawEscrow
    const EscrowFactory = await ethers.getContractFactory("ClawEscrow");
    escrow = await upgrades.deployProxy(
      EscrowFactory,
      [tokenAddr, deployer.address, ESCROW_BASE_RATE, ESCROW_HOLDING_RATE, ESCROW_MIN_FEE],
      { kind: "uups", initializer: "initialize" },
    );
    await escrow.waitForDeployment();
    escrowAddr = await escrow.getAddress();

    // 3. ClawIdentity
    const IdentityFactory = await ethers.getContractFactory("ClawIdentity");
    identity = await upgrades.deployProxy(
      IdentityFactory,
      [deployer.address],
      { kind: "uups", initializer: "initialize" },
    );
    await identity.waitForDeployment();
    identityAddr = await identity.getAddress();

    // 4. ClawStaking
    const StakingFactory = await ethers.getContractFactory("ClawStaking");
    staking = await upgrades.deployProxy(
      StakingFactory,
      [tokenAddr, MIN_STAKE, UNSTAKE_COOLDOWN, REWARD_PER_EPOCH, SLASH_PER_VIOLATION],
      { kind: "uups", initializer: "initialize" },
    );
    await staking.waitForDeployment();
    stakingAddr = await staking.getAddress();

    // 5. Grant MINTER_ROLE to Staking on ClawToken
    await token.grantRole(MINTER_ROLE, stakingAddr);
  });

  it("should deploy all 4 contracts to non-zero addresses", async function () {
    expect(tokenAddr).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(escrowAddr).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(identityAddr).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(stakingAddr).to.match(/^0x[0-9a-fA-F]{40}$/);
    // All different addresses
    const addrs = [tokenAddr, escrowAddr, identityAddr, stakingAddr];
    expect(new Set(addrs).size).to.equal(4);
  });

  // -----------------------------------------------------------------------
  // Scenario 2: Register DID on-chain
  // -----------------------------------------------------------------------
  describe("Identity: DID Registration", function () {
    const alicePubKey = ethers.randomBytes(32);
    let aliceDidHash: string;

    before(function () {
      aliceDidHash = ethers.keccak256(ethers.toUtf8Bytes("did:claw:alice123"));
    });

    it("should register Alice's DID", async function () {
      await identity.connect(alice).registerDID(
        aliceDidHash,
        alicePubKey,
        0, // Authentication
        ethers.ZeroAddress,
      );
      expect(await identity.isActive(aliceDidHash)).to.be.true;
    });

    it("should resolve Alice's DID with correct controller", async function () {
      const controller = await identity.getController(aliceDidHash);
      expect(controller).to.equal(alice.address);
    });

    it("should return Alice's active key", async function () {
      const key = await identity.getActiveKey(aliceDidHash);
      expect(key).to.equal(ethers.hexlify(alicePubKey));
    });

    it("should show didCount = 1", async function () {
      expect(await identity.didCount()).to.equal(1);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 3: Mint → Transfer tokens
  // -----------------------------------------------------------------------
  describe("Token: Mint & Transfer", function () {
    it("should mint 100,000 Tokens to Alice", async function () {
      await token.mint(alice.address, 100_000);
      expect(await token.balanceOf(alice.address)).to.equal(100_000);
    });

    it("should transfer 10,000 Tokens from Alice to Bob", async function () {
      await token.connect(alice).transfer(bob.address, 10_000);
      expect(await token.balanceOf(alice.address)).to.equal(90_000);
      expect(await token.balanceOf(bob.address)).to.equal(10_000);
    });

    it("should show total supply = 100,000", async function () {
      expect(await token.totalSupply()).to.equal(100_000);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 4: Create Escrow → Release → Verify balances
  // -----------------------------------------------------------------------
  describe("Escrow: Create → Release → Balance Check", function () {
    const escrowId = ethers.keccak256(ethers.toUtf8Bytes("escrow-001"));
    const escrowAmount = 1_000;
    let aliceBalanceBefore: bigint;
    let bobBalanceBefore: bigint;
    let expiresAt: number;

    before(async function () {
      aliceBalanceBefore = await token.balanceOf(alice.address);
      bobBalanceBefore = await token.balanceOf(bob.address);
      expiresAt = (await time.latest()) + 86400; // +1 day
    });

    it("should approve and create escrow (Alice → Bob)", async function () {
      // Alice approves escrow contract
      await token.connect(alice).approve(escrowAddr, escrowAmount);
      // Create escrow
      await escrow.connect(alice).createEscrow(
        escrowId,
        bob.address,
        arbiter.address,
        escrowAmount,
        expiresAt,
      );

      // Verify escrow state
      const rec = await escrow.escrows(escrowId);
      expect(rec.depositor).to.equal(alice.address);
      expect(rec.beneficiary).to.equal(bob.address);
      expect(rec.status).to.equal(0); // Active
    });

    it("should deduct tokens from Alice (amount + fee)", async function () {
      const aliceBalanceAfter = await token.balanceOf(alice.address);
      // Fee is deducted: Alice loses exactly `escrowAmount` (some goes to treasury as fee)
      expect(aliceBalanceAfter).to.equal(aliceBalanceBefore - BigInt(escrowAmount));
    });

    it("should release escrow funds to Bob", async function () {
      // Depositor (Alice) releases
      await escrow.connect(alice).release(escrowId);

      // Verify status changed
      const rec = await escrow.escrows(escrowId);
      expect(rec.status).to.equal(1); // Released
    });

    it("should credit Bob's balance after release", async function () {
      const bobBalanceAfter = await token.balanceOf(bob.address);
      // Bob receives netAmount (amount - fee)
      expect(bobBalanceAfter).to.be.gt(bobBalanceBefore);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 5: Stake → Query → Request Unstake
  // -----------------------------------------------------------------------
  describe("Staking: Stake → Query → Unstake", function () {
    const stakeAmount = 20_000;

    before(async function () {
      // Mint tokens to Alice for staking
      await token.mint(alice.address, stakeAmount);
    });

    it("should stake tokens (Alice stakes as Validator)", async function () {
      const balBefore = await token.balanceOf(alice.address);
      // Approve staking contract
      await token.connect(alice).approve(stakingAddr, stakeAmount);
      // Stake
      await staking.connect(alice).stake(stakeAmount, 0); // NodeType.Validator
      const balAfter = await token.balanceOf(alice.address);

      expect(balAfter).to.equal(balBefore - BigInt(stakeAmount));
    });

    it("should query staking status", async function () {
      const info = await staking.stakes(alice.address);
      expect(info.amount).to.equal(stakeAmount);
      expect(info.active).to.be.true;
      expect(info.nodeType).to.equal(0); // Validator
    });

    it("should include Alice in active validators", async function () {
      const validators = await staking.getActiveValidators();
      expect(validators).to.include(alice.address);
    });

    it("should request unstake", async function () {
      await staking.connect(alice).requestUnstake();
      const info = await staking.stakes(alice.address);
      expect(info.active).to.be.false;
      expect(info.unstakeRequestAt).to.be.gt(0);
    });

    it("should remove Alice from active validators after requestUnstake", async function () {
      const validators = await staking.getActiveValidators();
      expect(validators).to.not.include(alice.address);
    });

    it("should unstake after cooldown period", async function () {
      // Fast-forward 7 days
      await time.increase(UNSTAKE_COOLDOWN);

      const balBefore = await token.balanceOf(alice.address);
      await staking.connect(alice).unstake();
      const balAfter = await token.balanceOf(alice.address);

      // Should get full stake back (no slashing occurred)
      expect(balAfter).to.equal(balBefore + BigInt(stakeAmount));
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 6: Cross-contract role verification
  // -----------------------------------------------------------------------
  describe("Cross-contract: Role Grants", function () {
    it("Staking contract should have MINTER_ROLE on ClawToken", async function () {
      expect(await token.hasRole(MINTER_ROLE, stakingAddr)).to.be.true;
    });

    it("random address should NOT have MINTER_ROLE", async function () {
      expect(await token.hasRole(MINTER_ROLE, bob.address)).to.be.false;
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 7: Full cycle — DID + Token + Escrow in sequence
  // -----------------------------------------------------------------------
  describe("Full Cycle: Register DID → Mint → Escrow → Stake", function () {
    const bobPubKey = ethers.randomBytes(32);
    const bobDidHash = ethers.keccak256(ethers.toUtf8Bytes("did:claw:bob456"));
    const cycleEscrowId = ethers.keccak256(ethers.toUtf8Bytes("escrow-cycle"));

    it("should register Bob's DID", async function () {
      await identity.connect(bob).registerDID(
        bobDidHash,
        bobPubKey,
        0,
        ethers.ZeroAddress,
      );
      expect(await identity.isActive(bobDidHash)).to.be.true;
      expect(await identity.didCount()).to.equal(2);
    });

    it("should mint tokens to Bob and create escrow to Alice", async function () {
      await token.mint(bob.address, 50_000);
      const expiresAt = (await time.latest()) + 172800; // +2 days

      await token.connect(bob).approve(escrowAddr, 5_000);
      await escrow.connect(bob).createEscrow(
        cycleEscrowId,
        alice.address,
        arbiter.address,
        5_000,
        expiresAt,
      );

      const rec = await escrow.escrows(cycleEscrowId);
      expect(rec.depositor).to.equal(bob.address);
      expect(rec.beneficiary).to.equal(alice.address);
      expect(rec.status).to.equal(0); // Active
    });

    it("should refund escrow back to Bob", async function () {
      const bobBefore = await token.balanceOf(bob.address);
      // Beneficiary (Alice) refunds
      await escrow.connect(alice).refund(cycleEscrowId);

      const rec = await escrow.escrows(cycleEscrowId);
      expect(rec.status).to.equal(2); // Refunded

      const bobAfter = await token.balanceOf(bob.address);
      expect(bobAfter).to.be.gt(bobBefore);
    });

    it("should stake Bob's tokens", async function () {
      const balance = await token.balanceOf(bob.address);
      const stakeAmt = MIN_STAKE;

      await token.connect(bob).approve(stakingAddr, stakeAmt);
      await staking.connect(bob).stake(stakeAmt, 1); // NodeType.Relay

      const info = await staking.stakes(bob.address);
      expect(info.amount).to.equal(stakeAmt);
      expect(info.nodeType).to.equal(1); // Relay
      expect(info.active).to.be.true;
    });
  });
});
