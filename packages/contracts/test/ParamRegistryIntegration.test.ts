import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { ClawToken, ClawEscrow, ClawStaking, ParamRegistry } from "../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Tests that ClawEscrow and ClawStaking correctly read params from ParamRegistry
 * when it is set, and fall back to local storage when it is not set.
 */
describe("ParamRegistry Integration", function () {
  let token: ClawToken;
  let escrow: ClawEscrow;
  let staking: ClawStaking;
  let registry: ParamRegistry;
  let admin: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let arbiter: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;

  const INITIAL_SUPPLY = 1_000_000n;
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const GOVERNOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GOVERNOR_ROLE"));

  async function deployAll() {
    [admin, user1, user2, arbiter, treasury] = await ethers.getSigners();

    // Deploy Token
    const TokenFactory = await ethers.getContractFactory("ClawToken");
    token = (await upgrades.deployProxy(TokenFactory, ["ClawToken", "CLAW", admin.address], {
      kind: "uups",
    })) as unknown as ClawToken;
    await token.waitForDeployment();
    await token.mint(admin.address, INITIAL_SUPPLY);

    // Deploy ParamRegistry
    const RegFactory = await ethers.getContractFactory("ParamRegistry");
    registry = (await upgrades.deployProxy(RegFactory, [admin.address], {
      kind: "uups",
    })) as unknown as ParamRegistry;
    await registry.waitForDeployment();

    // Deploy Escrow with default params: baseRate=100 (1%), holdingRate=5, minFee=1
    const EscrowFactory = await ethers.getContractFactory("ClawEscrow");
    escrow = (await upgrades.deployProxy(
      EscrowFactory,
      [await token.getAddress(), treasury.address, 100, 5, 1],
      { kind: "uups" }
    )) as unknown as ClawEscrow;
    await escrow.waitForDeployment();

    // Deploy Staking with default params
    const StakingFactory = await ethers.getContractFactory("ClawStaking");
    staking = (await upgrades.deployProxy(
      StakingFactory,
      [await token.getAddress(), 10000, 604800, 1, 1],
      { kind: "uups" }
    )) as unknown as ClawStaking;
    await staking.waitForDeployment();

    // Fund users
    await token.mint(user1.address, 500_000n);
    await token.mint(user2.address, 500_000n);
  }

  beforeEach(async function () {
    await deployAll();
  });

  // ─── ClawEscrow + ParamRegistry ────────────────────────────────

  describe("ClawEscrow with ParamRegistry", function () {
    it("should use local params when registry not set", async function () {
      // Default baseRate=100 (1%), for 1000 Token, 1 day: fee = ceil(1000*100/10000) + ceil(1000*5*1/10000) = 10 + 1 = 11
      const fee = await escrow.calculateFee(1000, 1);
      expect(fee).to.equal(11);
    });

    it("should read fee params from registry when set", async function () {
      // Set registry with different params
      await escrow.setParamRegistry(await registry.getAddress());

      // Set ESCROW_BASE_RATE = 200 (2%) in registry
      const ESCROW_BASE_RATE = await registry.ESCROW_BASE_RATE();
      await registry.setParam(ESCROW_BASE_RATE, 200);

      // Now: baseRate from registry=200, holdingRate fallback=5, minFee fallback=1
      // 1000 * 200 / 10000 = 20, holdFee = ceil(1000*5*1/10000)=1, total=21
      const fee = await escrow.calculateFee(1000, 1);
      expect(fee).to.equal(21);
    });

    it("should fall back to local params when registry param not set", async function () {
      await escrow.setParamRegistry(await registry.getAddress());

      // Don't set any params in registry — should fall back to local storage values
      // Local: baseRate=100, holdingRate=5, minFee=1
      const fee = await escrow.calculateFee(1000, 1);
      expect(fee).to.equal(11); // same as without registry
    });

    it("should use registry minFee override", async function () {
      await escrow.setParamRegistry(await registry.getAddress());

      const ESCROW_MIN_FEE = await registry.ESCROW_MIN_FEE();
      await registry.setParam(ESCROW_MIN_FEE, 50);

      // For small amount where computed fee < 50: fee = 50 (minFee from registry)
      const fee = await escrow.calculateFee(100, 1);
      // 100*100/10000=1, 100*5*1/10000≈1, total=2 < 50 → minFee=50
      expect(fee).to.equal(50);
    });

    it("should apply registry params to actual escrow creation", async function () {
      await escrow.setParamRegistry(await registry.getAddress());

      const ESCROW_BASE_RATE = await registry.ESCROW_BASE_RATE();
      await registry.setParam(ESCROW_BASE_RATE, 500); // 5%

      const escrowId = ethers.keccak256(ethers.toUtf8Bytes("test-escrow-1"));
      const amount = 10000n;
      const now = await time.latest();
      const expiresAt = now + 86400; // 1 day

      await token.connect(user1).approve(await escrow.getAddress(), amount);
      await escrow.connect(user1).createEscrow(
        escrowId,
        user2.address,
        arbiter.address,
        amount,
        expiresAt
      );

      // Fee = max(1, ceil(10000*500/10000) + ceil(10000*5*1/10000)) = max(1, 500+5) = 505
      const record = await escrow.escrows(escrowId);
      expect(record.amount).to.equal(amount - 505n);
    });

    it("should revert setParamRegistry for non-admin", async function () {
      await expect(
        escrow.connect(user1).setParamRegistry(await registry.getAddress())
      ).to.be.reverted;
    });

    it("should disable registry by setting to zero address", async function () {
      await escrow.setParamRegistry(await registry.getAddress());
      const ESCROW_BASE_RATE = await registry.ESCROW_BASE_RATE();
      await registry.setParam(ESCROW_BASE_RATE, 500);

      // With registry: fee is higher
      const feeWithRegistry = await escrow.calculateFee(1000, 1);

      // Disable registry
      await escrow.setParamRegistry(ethers.ZeroAddress);

      // Back to local params
      const feeWithout = await escrow.calculateFee(1000, 1);
      expect(feeWithout).to.be.lt(feeWithRegistry);
      expect(feeWithout).to.equal(11); // original local params
    });
  });

  // ─── ClawStaking + ParamRegistry ───────────────────────────────

  describe("ClawStaking with ParamRegistry", function () {
    it("should use local minStake when registry not set", async function () {
      // Local minStake = 10000
      await token.connect(user1).approve(await staking.getAddress(), 10000);
      await staking.connect(user1).stake(10000, 0); // Validator
      expect((await staking.stakes(user1.address)).active).to.equal(true);
    });

    it("should use registry minStake when set", async function () {
      await staking.setParamRegistry(await registry.getAddress());

      const MIN_NODE_STAKE = await registry.MIN_NODE_STAKE();
      await registry.setParam(MIN_NODE_STAKE, 20000);

      // 10000 should now be rejected (registry says 20000 minimum)
      await token.connect(user1).approve(await staking.getAddress(), 10000);
      await expect(
        staking.connect(user1).stake(10000, 0)
      ).to.be.revertedWithCustomError(staking, "InsufficientStake");

      // 20000 should work
      await token.connect(user1).approve(await staking.getAddress(), 20000);
      await staking.connect(user1).stake(20000, 0);
      expect((await staking.stakes(user1.address)).active).to.equal(true);
    });

    it("should use registry unstakeCooldown when set", async function () {
      await staking.setParamRegistry(await registry.getAddress());

      const UNSTAKE_COOLDOWN = await registry.UNSTAKE_COOLDOWN();
      await registry.setParam(UNSTAKE_COOLDOWN, 3600); // 1 hour instead of 7 days

      await token.connect(user1).approve(await staking.getAddress(), 10000);
      await staking.connect(user1).stake(10000, 0);
      await staking.connect(user1).requestUnstake();

      // Advance 1 hour
      await time.increase(3601);

      // Should be able to unstake now (with 1-hour cooldown from registry)
      await staking.connect(user1).unstake();
      expect((await staking.stakes(user1.address)).amount).to.equal(0);
    });

    it("should fall back to local cooldown when registry param not set", async function () {
      await staking.setParamRegistry(await registry.getAddress());
      // Don't set UNSTAKE_COOLDOWN in registry

      await token.connect(user1).approve(await staking.getAddress(), 10000);
      await staking.connect(user1).stake(10000, 0);
      await staking.connect(user1).requestUnstake();

      // Advance 1 hour — should NOT be enough (local default = 7 days)
      await time.increase(3601);
      await expect(
        staking.connect(user1).unstake()
      ).to.be.revertedWithCustomError(staking, "CooldownNotElapsed");

      // Advance 7 days
      await time.increase(604800);
      await staking.connect(user1).unstake();
    });

    it("should revert setParamRegistry for non-admin", async function () {
      await expect(
        staking.connect(user1).setParamRegistry(await registry.getAddress())
      ).to.be.reverted;
    });

    it("DAO governance flow: propose registry param change → staking applies it", async function () {
      await staking.setParamRegistry(await registry.getAddress());

      // Simulate DAO setting MIN_NODE_STAKE from 10000 → 50000
      const MIN_NODE_STAKE = await registry.MIN_NODE_STAKE();
      await registry.setParam(MIN_NODE_STAKE, 50000);

      // User1 cannot stake 10000 anymore
      await token.connect(user1).approve(await staking.getAddress(), 10000);
      await expect(
        staking.connect(user1).stake(10000, 0)
      ).to.be.revertedWithCustomError(staking, "InsufficientStake");

      // User1 can stake 50000
      await token.connect(user1).approve(await staking.getAddress(), 50000);
      await staking.connect(user1).stake(50000, 0);
      expect((await staking.stakes(user1.address)).active).to.equal(true);
    });
  });
});
