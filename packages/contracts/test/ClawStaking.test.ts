import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { ClawToken, ClawStaking } from "../typechain-types";

describe("ClawStaking", function () {
  let token: ClawToken;
  let staking: ClawStaking;
  let admin: HardhatEthersSigner;
  let node1: HardhatEthersSigner;
  let node2: HardhatEthersSigner;
  let node3: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;

  // MVP defaults
  const MIN_STAKE = 10_000n;
  const COOLDOWN = 7n * 86400n; // 7 days in seconds
  const REWARD_PER_EPOCH = 1n;
  const SLASH_PER_VIOLATION = 1n;

  // NodeType enum
  const NT_VALIDATOR = 0;
  const NT_RELAY = 1;

  async function deployFixture() {
    [admin, node1, node2, node3, outsider] = await ethers.getSigners();

    // Deploy ClawToken
    const TokenFactory = await ethers.getContractFactory("ClawToken");
    const tokenProxy = await upgrades.deployProxy(
      TokenFactory,
      ["ClawNet Token", "TOKEN", admin.address],
      { kind: "uups", initializer: "initialize" },
    );
    await tokenProxy.waitForDeployment();
    token = tokenProxy as unknown as ClawToken;

    // Deploy ClawStaking
    const StakingFactory = await ethers.getContractFactory("ClawStaking");
    const stakingProxy = await upgrades.deployProxy(
      StakingFactory,
      [await token.getAddress(), MIN_STAKE, COOLDOWN, REWARD_PER_EPOCH, SLASH_PER_VIOLATION],
      { kind: "uups", initializer: "initialize" },
    );
    await stakingProxy.waitForDeployment();
    staking = stakingProxy as unknown as ClawStaking;

    // Mint tokens to nodes
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    await token.connect(admin).grantRole(MINTER_ROLE, admin.address);
    await token.connect(admin).mint(node1.address, 100_000);
    await token.connect(admin).mint(node2.address, 100_000);
    await token.connect(admin).mint(node3.address, 100_000);

    // Also fund the staking contract with reward tokens
    await token.connect(admin).mint(await staking.getAddress(), 50_000);

    return { token, staking, admin, node1, node2, node3, outsider };
  }

  async function stakeDefaultNode1() {
    await token.connect(node1).approve(await staking.getAddress(), MIN_STAKE);
    await staking.connect(node1).stake(MIN_STAKE, NT_VALIDATOR);
  }

  beforeEach(async function () {
    await deployFixture();
  });

  // ─── Initialization ────────────────────────────────────────────────

  describe("Initialization", function () {
    it("should set token address", async function () {
      expect(await staking.token()).to.equal(await token.getAddress());
    });

    it("should set staking parameters", async function () {
      expect(await staking.minStake()).to.equal(MIN_STAKE);
      expect(await staking.unstakeCooldown()).to.equal(COOLDOWN);
      expect(await staking.rewardPerEpoch()).to.equal(REWARD_PER_EPOCH);
      expect(await staking.slashPerViolation()).to.equal(SLASH_PER_VIOLATION);
    });

    it("should not allow re-initialization", async function () {
      await expect(
        staking.initialize(await token.getAddress(), 0, 0, 0, 0),
      ).to.be.revertedWithCustomError(staking, "InvalidInitialization");
    });
  });

  // ─── Stake ─────────────────────────────────────────────────────────

  describe("stake", function () {
    it("should stake successfully", async function () {
      await token.connect(node1).approve(await staking.getAddress(), MIN_STAKE);
      await staking.connect(node1).stake(MIN_STAKE, NT_VALIDATOR);

      expect(await staking.isActiveValidator(node1.address)).to.be.true;
      expect(await staking.activeValidatorCount()).to.equal(1);

      const info = await staking.getStakeInfo(node1.address);
      expect(info.amount).to.equal(MIN_STAKE);
      expect(info.active).to.be.true;
      expect(info.nodeType).to.equal(NT_VALIDATOR);
    });

    it("should transfer tokens from staker to contract", async function () {
      const contractAddr = await staking.getAddress();
      const balBefore = await token.balanceOf(contractAddr);

      await token.connect(node1).approve(contractAddr, MIN_STAKE);
      await staking.connect(node1).stake(MIN_STAKE, NT_VALIDATOR);

      const balAfter = await token.balanceOf(contractAddr);
      expect(balAfter - balBefore).to.equal(MIN_STAKE);
    });

    it("should emit Staked event", async function () {
      await token.connect(node1).approve(await staking.getAddress(), MIN_STAKE);
      await expect(staking.connect(node1).stake(MIN_STAKE, NT_VALIDATOR))
        .to.emit(staking, "Staked")
        .withArgs(node1.address, MIN_STAKE, NT_VALIDATOR);
    });

    it("should add node to active validators list", async function () {
      await token.connect(node1).approve(await staking.getAddress(), MIN_STAKE);
      await staking.connect(node1).stake(MIN_STAKE, NT_VALIDATOR);

      const validators = await staking.getActiveValidators();
      expect(validators).to.include(node1.address);
    });

    it("should revert below minimum stake", async function () {
      const lowAmount = MIN_STAKE - 1n;
      await token.connect(node1).approve(await staking.getAddress(), lowAmount);
      await expect(
        staking.connect(node1).stake(lowAmount, NT_VALIDATOR),
      ).to.be.revertedWithCustomError(staking, "InsufficientStake");
    });

    it("should revert if already staked", async function () {
      await stakeDefaultNode1();
      await token.connect(node1).approve(await staking.getAddress(), MIN_STAKE);
      await expect(
        staking.connect(node1).stake(MIN_STAKE, NT_VALIDATOR),
      ).to.be.revertedWithCustomError(staking, "AlreadyStaked");
    });

    it("should allow staking above minimum", async function () {
      const bigStake = MIN_STAKE * 2n;
      await token.connect(node1).approve(await staking.getAddress(), bigStake);
      await staking.connect(node1).stake(bigStake, NT_RELAY);

      const info = await staking.getStakeInfo(node1.address);
      expect(info.amount).to.equal(bigStake);
      expect(info.nodeType).to.equal(NT_RELAY);
    });
  });

  // ─── Request Unstake ───────────────────────────────────────────────

  describe("requestUnstake", function () {
    beforeEach(async function () {
      await stakeDefaultNode1();
    });

    it("should request unstake successfully", async function () {
      await staking.connect(node1).requestUnstake();

      const info = await staking.getStakeInfo(node1.address);
      expect(info.active).to.be.false;
      expect(info.unstakeRequestAt).to.be.greaterThan(0);
    });

    it("should remove from active validators", async function () {
      await staking.connect(node1).requestUnstake();
      expect(await staking.isActiveValidator(node1.address)).to.be.false;
      expect(await staking.activeValidatorCount()).to.equal(0);
    });

    it("should emit UnstakeRequested event", async function () {
      const tx = staking.connect(node1).requestUnstake();
      await expect(tx).to.emit(staking, "UnstakeRequested");
    });

    it("should revert if not staked", async function () {
      await expect(
        staking.connect(outsider).requestUnstake(),
      ).to.be.revertedWithCustomError(staking, "NotStaked");
    });

    it("should revert if already requested", async function () {
      await staking.connect(node1).requestUnstake();
      // After requestUnstake, active=false, so second call reverts with NotStaked
      await expect(
        staking.connect(node1).requestUnstake(),
      ).to.be.revertedWithCustomError(staking, "NotStaked");
    });
  });

  // ─── Unstake ───────────────────────────────────────────────────────

  describe("unstake", function () {
    beforeEach(async function () {
      await stakeDefaultNode1();
      await staking.connect(node1).requestUnstake();
    });

    it("should revert during cooldown", async function () {
      await expect(
        staking.connect(node1).unstake(),
      ).to.be.revertedWithCustomError(staking, "CooldownNotElapsed");
    });

    it("should unstake after cooldown and return tokens", async function () {
      await time.increase(Number(COOLDOWN) + 1);

      const balBefore = await token.balanceOf(node1.address);
      await staking.connect(node1).unstake();
      const balAfter = await token.balanceOf(node1.address);

      expect(balAfter - balBefore).to.equal(MIN_STAKE);

      // Stake info should be cleared
      const info = await staking.getStakeInfo(node1.address);
      expect(info.amount).to.equal(0);
    });

    it("should emit Unstaked event", async function () {
      await time.increase(Number(COOLDOWN) + 1);
      await expect(staking.connect(node1).unstake())
        .to.emit(staking, "Unstaked")
        .withArgs(node1.address, MIN_STAKE);
    });

    it("should return amount minus slashed", async function () {
      // Slash 500 before unstaking
      const SLASHER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SLASHER_ROLE"));
      await staking.connect(admin).grantRole(SLASHER_ROLE, admin.address);
      const reason = ethers.keccak256(ethers.toUtf8Bytes("offline"));
      await staking.connect(admin).slash(node1.address, 500, reason);

      await time.increase(Number(COOLDOWN) + 1);

      const balBefore = await token.balanceOf(node1.address);
      await staking.connect(node1).unstake();
      const balAfter = await token.balanceOf(node1.address);

      expect(balAfter - balBefore).to.equal(MIN_STAKE - 500n);
    });

    it("should revert if unstake not requested", async function () {
      // Stake node2 but don't request unstake
      await token.connect(node2).approve(await staking.getAddress(), MIN_STAKE);
      await staking.connect(node2).stake(MIN_STAKE, NT_VALIDATOR);

      await expect(
        staking.connect(node2).unstake(),
      ).to.be.revertedWithCustomError(staking, "UnstakeNotRequested");
    });

    it("should return 0 if fully slashed", async function () {
      const SLASHER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SLASHER_ROLE"));
      await staking.connect(admin).grantRole(SLASHER_ROLE, admin.address);
      const reason = ethers.keccak256(ethers.toUtf8Bytes("extreme-violation"));
      await staking.connect(admin).slash(node1.address, Number(MIN_STAKE), reason);

      await time.increase(Number(COOLDOWN) + 1);

      const balBefore = await token.balanceOf(node1.address);
      await staking.connect(node1).unstake();
      const balAfter = await token.balanceOf(node1.address);

      expect(balAfter - balBefore).to.equal(0);
    });
  });

  // ─── Slash ─────────────────────────────────────────────────────────

  describe("slash", function () {
    beforeEach(async function () {
      await stakeDefaultNode1();
    });

    it("SLASHER_ROLE can slash a staked node", async function () {
      const reason = ethers.keccak256(ethers.toUtf8Bytes("offline"));
      await staking.connect(admin).slash(node1.address, 100, reason);

      const info = await staking.getStakeInfo(node1.address);
      expect(info.slashed).to.equal(100);
    });

    it("should emit Slashed event", async function () {
      const reason = ethers.keccak256(ethers.toUtf8Bytes("offline"));
      await expect(staking.connect(admin).slash(node1.address, 100, reason))
        .to.emit(staking, "Slashed")
        .withArgs(node1.address, 100, reason);
    });

    it("should cap slash at remaining amount", async function () {
      const reason = ethers.keccak256(ethers.toUtf8Bytes("extreme"));
      // Slash more than staked
      await staking.connect(admin).slash(node1.address, Number(MIN_STAKE) + 5000, reason);

      const info = await staking.getStakeInfo(node1.address);
      expect(info.slashed).to.equal(MIN_STAKE);
    });

    it("non-SLASHER cannot slash", async function () {
      const reason = ethers.keccak256(ethers.toUtf8Bytes("offline"));
      await expect(
        staking.connect(outsider).slash(node1.address, 100, reason),
      ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount");
    });

    it("should revert on zero amount", async function () {
      const reason = ethers.keccak256(ethers.toUtf8Bytes("offline"));
      await expect(
        staking.connect(admin).slash(node1.address, 0, reason),
      ).to.be.revertedWithCustomError(staking, "InvalidAmount");
    });

    it("should revert if node not staked", async function () {
      const reason = ethers.keccak256(ethers.toUtf8Bytes("offline"));
      await expect(
        staking.connect(admin).slash(outsider.address, 100, reason),
      ).to.be.revertedWithCustomError(staking, "NotStaked");
    });
  });

  // ─── Distribute Rewards ────────────────────────────────────────────

  describe("distributeRewards", function () {
    beforeEach(async function () {
      await stakeDefaultNode1();
      await token.connect(node2).approve(await staking.getAddress(), MIN_STAKE);
      await staking.connect(node2).stake(MIN_STAKE, NT_RELAY);
    });

    it("DISTRIBUTOR_ROLE can distribute rewards", async function () {
      await staking.connect(admin).distributeRewards(
        [node1.address, node2.address],
        [50, 30],
      );

      const info1 = await staking.getStakeInfo(node1.address);
      const info2 = await staking.getStakeInfo(node2.address);
      expect(info1.rewards).to.equal(50);
      expect(info2.rewards).to.equal(30);
    });

    it("should emit RewardsDistributed event", async function () {
      await expect(
        staking.connect(admin).distributeRewards([node1.address], [100]),
      ).to.emit(staking, "RewardsDistributed")
        .withArgs(100, 1);
    });

    it("should revert on array length mismatch", async function () {
      await expect(
        staking.connect(admin).distributeRewards([node1.address, node2.address], [100]),
      ).to.be.revertedWithCustomError(staking, "ArrayLengthMismatch");
    });

    it("should skip non-staked addresses silently", async function () {
      await staking.connect(admin).distributeRewards(
        [node1.address, outsider.address],
        [100, 50],
      );

      const info1 = await staking.getStakeInfo(node1.address);
      expect(info1.rewards).to.equal(100);
      // outsider's rewards = 0 (no stake)
    });

    it("non-DISTRIBUTOR cannot distribute", async function () {
      await expect(
        staking.connect(outsider).distributeRewards([node1.address], [100]),
      ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount");
    });
  });

  // ─── Claim Rewards ─────────────────────────────────────────────────

  describe("claimRewards", function () {
    beforeEach(async function () {
      await stakeDefaultNode1();
      await staking.connect(admin).distributeRewards([node1.address], [200]);
    });

    it("should claim rewards successfully", async function () {
      const balBefore = await token.balanceOf(node1.address);
      await staking.connect(node1).claimRewards();
      const balAfter = await token.balanceOf(node1.address);

      expect(balAfter - balBefore).to.equal(200);

      const info = await staking.getStakeInfo(node1.address);
      expect(info.rewards).to.equal(0);
    });

    it("should emit RewardClaimed event", async function () {
      await expect(staking.connect(node1).claimRewards())
        .to.emit(staking, "RewardClaimed")
        .withArgs(node1.address, 200);
    });

    it("should revert if no rewards", async function () {
      await staking.connect(node1).claimRewards(); // claim once
      await expect(
        staking.connect(node1).claimRewards(), // claim again
      ).to.be.revertedWithCustomError(staking, "NoRewards");
    });

    it("should revert if not staked", async function () {
      await expect(
        staking.connect(outsider).claimRewards(),
      ).to.be.revertedWithCustomError(staking, "NotStaked");
    });
  });

  // ─── Active validator list management ─────────────────────────────

  describe("Active validator list", function () {
    it("should track multiple validators", async function () {
      await token.connect(node1).approve(await staking.getAddress(), MIN_STAKE);
      await staking.connect(node1).stake(MIN_STAKE, NT_VALIDATOR);

      await token.connect(node2).approve(await staking.getAddress(), MIN_STAKE);
      await staking.connect(node2).stake(MIN_STAKE, NT_RELAY);

      expect(await staking.activeValidatorCount()).to.equal(2);

      const validators = await staking.getActiveValidators();
      expect(validators).to.include(node1.address);
      expect(validators).to.include(node2.address);
    });

    it("swap-and-pop removes correctly from middle", async function () {
      // Stake 3 nodes
      await token.connect(node1).approve(await staking.getAddress(), MIN_STAKE);
      await staking.connect(node1).stake(MIN_STAKE, NT_VALIDATOR);
      await token.connect(node2).approve(await staking.getAddress(), MIN_STAKE);
      await staking.connect(node2).stake(MIN_STAKE, NT_VALIDATOR);
      await token.connect(node3).approve(await staking.getAddress(), MIN_STAKE);
      await staking.connect(node3).stake(MIN_STAKE, NT_VALIDATOR);

      expect(await staking.activeValidatorCount()).to.equal(3);

      // Remove middle (node2)
      await staking.connect(node2).requestUnstake();
      expect(await staking.activeValidatorCount()).to.equal(2);

      const validators = await staking.getActiveValidators();
      expect(validators).to.not.include(node2.address);
      expect(validators).to.include(node1.address);
      expect(validators).to.include(node3.address);
    });
  });

  // ─── Pause ─────────────────────────────────────────────────────────

  describe("Pause", function () {
    it("PAUSER can pause", async function () {
      await staking.connect(admin).pause();
      expect(await staking.paused()).to.be.true;
    });

    it("pause blocks stake", async function () {
      await staking.connect(admin).pause();
      await token.connect(node1).approve(await staking.getAddress(), MIN_STAKE);
      await expect(
        staking.connect(node1).stake(MIN_STAKE, NT_VALIDATOR),
      ).to.be.revertedWithCustomError(staking, "EnforcedPause");
    });

    it("pause blocks requestUnstake", async function () {
      await stakeDefaultNode1();
      await staking.connect(admin).pause();
      await expect(
        staking.connect(node1).requestUnstake(),
      ).to.be.revertedWithCustomError(staking, "EnforcedPause");
    });

    it("pause blocks unstake", async function () {
      await stakeDefaultNode1();
      await staking.connect(node1).requestUnstake();
      await time.increase(Number(COOLDOWN) + 1);
      await staking.connect(admin).pause();
      await expect(
        staking.connect(node1).unstake(),
      ).to.be.revertedWithCustomError(staking, "EnforcedPause");
    });

    it("pause blocks claimRewards", async function () {
      await stakeDefaultNode1();
      await staking.connect(admin).distributeRewards([node1.address], [100]);
      await staking.connect(admin).pause();
      await expect(
        staking.connect(node1).claimRewards(),
      ).to.be.revertedWithCustomError(staking, "EnforcedPause");
    });

    it("pause blocks slash", async function () {
      await stakeDefaultNode1();
      await staking.connect(admin).pause();
      const reason = ethers.keccak256(ethers.toUtf8Bytes("offline"));
      await expect(
        staking.connect(admin).slash(node1.address, 100, reason),
      ).to.be.revertedWithCustomError(staking, "EnforcedPause");
    });

    it("pause blocks distributeRewards", async function () {
      await stakeDefaultNode1();
      await staking.connect(admin).pause();
      await expect(
        staking.connect(admin).distributeRewards([node1.address], [100]),
      ).to.be.revertedWithCustomError(staking, "EnforcedPause");
    });

    it("unpause re-enables operations", async function () {
      await staking.connect(admin).pause();
      await staking.connect(admin).unpause();

      await token.connect(node1).approve(await staking.getAddress(), MIN_STAKE);
      await staking.connect(node1).stake(MIN_STAKE, NT_VALIDATOR);
      expect(await staking.isActiveValidator(node1.address)).to.be.true;
    });

    it("non-PAUSER cannot pause", async function () {
      await expect(
        staking.connect(outsider).pause(),
      ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount");
    });
  });

  // ─── Admin ─────────────────────────────────────────────────────────

  describe("Admin functions", function () {
    it("admin can update params", async function () {
      await staking.connect(admin).setParams(20_000, 14 * 86400, 2, 5);
      expect(await staking.minStake()).to.equal(20_000);
      expect(await staking.unstakeCooldown()).to.equal(14 * 86400);
      expect(await staking.rewardPerEpoch()).to.equal(2);
      expect(await staking.slashPerViolation()).to.equal(5);
    });

    it("non-admin cannot update params", async function () {
      await expect(
        staking.connect(outsider).setParams(1, 1, 1, 1),
      ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount");
    });
  });

  // ─── Upgrade (UUPS) ───────────────────────────────────────────────

  describe("Upgrade (UUPS)", function () {
    it("admin can upgrade and state is preserved", async function () {
      await stakeDefaultNode1();

      const FactoryV2 = await ethers.getContractFactory("ClawStaking");
      const upgraded = await upgrades.upgradeProxy(
        await staking.getAddress(), FactoryV2, { kind: "uups" },
      );
      const s2 = upgraded as unknown as ClawStaking;

      expect(await s2.isActiveValidator(node1.address)).to.be.true;
      const info = await s2.getStakeInfo(node1.address);
      expect(info.amount).to.equal(MIN_STAKE);
    });

    it("non-admin cannot upgrade", async function () {
      const FactoryV2 = await ethers.getContractFactory("ClawStaking", outsider);
      await expect(
        upgrades.upgradeProxy(await staking.getAddress(), FactoryV2, { kind: "uups" }),
      ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount");
    });
  });
});
