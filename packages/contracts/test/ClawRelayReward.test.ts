import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { ClawToken, ClawRelayReward } from "../typechain-types";

describe("ClawRelayReward", function () {
  let token: ClawToken;
  let reward: ClawRelayReward;
  let admin: HardhatEthersSigner;
  let relay: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;

  // Default reward params
  const BASE_RATE = 100n;
  const MAX_PER_PERIOD = 1000n;
  const MIN_BYTES = 1_000_000n; // 1 MB
  const MIN_PEERS = 1n;
  const ATTACHMENT_WEIGHT_BPS = 3000n; // 0.3x

  const RELAY_DID_HASH = ethers.keccak256(ethers.toUtf8Bytes("did:claw:zRelay1"));
  const PEER_A_HASH = ethers.keccak256(ethers.toUtf8Bytes("did:claw:zPeerA"));
  const PEER_B_HASH = ethers.keccak256(ethers.toUtf8Bytes("did:claw:zPeerB"));

  const POOL_AMOUNT = 100_000n;

  async function deployFixture() {
    [admin, relay, outsider] = await ethers.getSigners();

    // Deploy ClawToken
    const TokenFactory = await ethers.getContractFactory("ClawToken");
    const tokenProxy = await upgrades.deployProxy(
      TokenFactory,
      ["ClawNet Token", "TOKEN", admin.address],
      { kind: "uups", initializer: "initialize" },
    );
    await tokenProxy.waitForDeployment();
    token = tokenProxy as unknown as ClawToken;

    // Deploy ClawRelayReward
    const RewardFactory = await ethers.getContractFactory("ClawRelayReward");
    const rewardProxy = await upgrades.deployProxy(
      RewardFactory,
      [await token.getAddress(), BASE_RATE, MAX_PER_PERIOD, MIN_BYTES, MIN_PEERS, ATTACHMENT_WEIGHT_BPS],
      { kind: "uups", initializer: "initialize" },
    );
    await rewardProxy.waitForDeployment();
    reward = rewardProxy as unknown as ClawRelayReward;

    // Mint to pool
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    await token.connect(admin).grantRole(MINTER_ROLE, admin.address);
    await token.connect(admin).mint(await reward.getAddress(), POOL_AMOUNT);

    return { token, reward, admin, relay, outsider };
  }

  /** Build a valid PeerConfirmation struct. */
  function peerConfirmation(
    peerDidHash: string,
    bytesConfirmed: bigint,
    circuitsConfirmed = 1n,
  ): ClawRelayReward.PeerConfirmationStruct {
    return {
      peerDidHash,
      bytesConfirmed,
      circuitsConfirmed,
      signature: ethers.toUtf8Bytes("mock-sig"),
    };
  }

  beforeEach(async function () {
    await deployFixture();
  });

  // ─── Initialization ──────────────────────────────────────────────

  describe("Initialization", function () {
    it("sets token address", async function () {
      expect(await reward.token()).to.equal(await token.getAddress());
    });

    it("sets reward parameters", async function () {
      const [baseRate, max, minB, minP, attBps] = await reward.getRewardParams();
      expect(baseRate).to.equal(BASE_RATE);
      expect(max).to.equal(MAX_PER_PERIOD);
      expect(minB).to.equal(MIN_BYTES);
      expect(minP).to.equal(MIN_PEERS);
      expect(attBps).to.equal(ATTACHMENT_WEIGHT_BPS);
    });

    it("pool has balance", async function () {
      expect(await reward.poolBalance()).to.equal(POOL_AMOUNT);
    });
  });

  // ─── claimReward ─────────────────────────────────────────────────

  describe("claimReward", function () {
    it("succeeds with valid claim", async function () {
      const confirmations = [peerConfirmation(PEER_A_HASH, 2_000_000n)];

      await expect(
        reward.connect(relay).claimReward(
          RELAY_DID_HASH, 1n,    // periodId
          2_000_000n, 0n,        // messaging, attachment
          5n,                    // circuits
          200n,                  // rewardAmount
          confirmations,
        ),
      ).to.emit(reward, "RewardClaimed")
        .withArgs(RELAY_DID_HASH, 1n, 200n, 2_000_000n, 1n);

      expect(await reward.lastClaimedPeriod(RELAY_DID_HASH)).to.equal(1n);
      expect(await reward.totalRewardsDistributed()).to.equal(200n);
      expect(await reward.getClaimCount(RELAY_DID_HASH)).to.equal(1n);
    });

    it("caps reward at maxRewardPerPeriod", async function () {
      const confirmations = [peerConfirmation(PEER_A_HASH, 5_000_000n)];

      await reward.connect(relay).claimReward(
        RELAY_DID_HASH, 1n,
        5_000_000n, 0n, 10n,
        9999n,  // exceeds MAX_PER_PERIOD
        confirmations,
      );

      // Should be capped to 1000
      expect(await reward.totalRewardsDistributed()).to.equal(MAX_PER_PERIOD);

      const history = await reward.getClaimHistory(RELAY_DID_HASH);
      expect(history[0].rewardAmount).to.equal(MAX_PER_PERIOD);
    });

    it("rejects duplicate period", async function () {
      const confirmations = [peerConfirmation(PEER_A_HASH, 2_000_000n)];

      await reward.connect(relay).claimReward(
        RELAY_DID_HASH, 1n, 2_000_000n, 0n, 1n, 100n, confirmations,
      );

      await expect(
        reward.connect(relay).claimReward(
          RELAY_DID_HASH, 1n, 2_000_000n, 0n, 1n, 100n, confirmations,
        ),
      ).to.be.revertedWith("Period already claimed or invalid");
    });

    it("rejects non-monotonic period", async function () {
      const confirmations = [peerConfirmation(PEER_A_HASH, 2_000_000n)];

      await reward.connect(relay).claimReward(
        RELAY_DID_HASH, 5n, 2_000_000n, 0n, 1n, 100n, confirmations,
      );

      // Try period 3 (< 5) → should fail
      await expect(
        reward.connect(relay).claimReward(
          RELAY_DID_HASH, 3n, 2_000_000n, 0n, 1n, 100n, confirmations,
        ),
      ).to.be.revertedWith("Period already claimed or invalid");
    });

    it("rejects self-relay", async function () {
      const selfConfirmation = [peerConfirmation(RELAY_DID_HASH, 2_000_000n)];

      await expect(
        reward.connect(relay).claimReward(
          RELAY_DID_HASH, 1n, 2_000_000n, 0n, 1n, 100n, selfConfirmation,
        ),
      ).to.be.revertedWith("Self-relay not allowed");
    });

    it("rejects duplicate peer confirmations", async function () {
      const duplicates = [
        peerConfirmation(PEER_A_HASH, 1_000_000n),
        peerConfirmation(PEER_A_HASH, 1_000_000n),
      ];

      await expect(
        reward.connect(relay).claimReward(
          RELAY_DID_HASH, 1n, 2_000_000n, 0n, 1n, 100n, duplicates,
        ),
      ).to.be.revertedWith("Duplicate peer confirmation");
    });

    it("rejects below minimum bytes threshold", async function () {
      // 500 bytes < 1 MB threshold
      const confirmations = [peerConfirmation(PEER_A_HASH, 500n)];

      await expect(
        reward.connect(relay).claimReward(
          RELAY_DID_HASH, 1n, 500n, 0n, 1n, 100n, confirmations,
        ),
      ).to.be.revertedWith("Below minimum bytes threshold");
    });

    it("rejects below minimum peers threshold", async function () {
      // 0 peer confirmations < 1 min peers
      await expect(
        reward.connect(relay).claimReward(
          RELAY_DID_HASH, 1n, 5_000_000n, 0n, 1n, 100n, [],
        ),
      ).to.be.revertedWith("Not enough peer confirmations");
    });

    it("allows multiple peers", async function () {
      const confirmations = [
        peerConfirmation(PEER_A_HASH, 1_000_000n),
        peerConfirmation(PEER_B_HASH, 1_000_000n),
      ];

      await reward.connect(relay).claimReward(
        RELAY_DID_HASH, 1n, 2_000_000n, 0n, 5n, 300n, confirmations,
      );

      const history = await reward.getClaimHistory(RELAY_DID_HASH);
      expect(history[0].confirmedPeers).to.equal(2n);
      expect(history[0].confirmedBytes).to.equal(2_000_000n);
    });

    it("rejects when pool balance is insufficient", async function () {
      // Drain the pool first by claiming max repeatedly
      const confirmations = [peerConfirmation(PEER_A_HASH, 5_000_000n)];

      for (let i = 1n; i <= 100n; i++) {
        await reward.connect(relay).claimReward(
          RELAY_DID_HASH, i, 5_000_000n, 0n, 1n, MAX_PER_PERIOD, confirmations,
        );
      }

      // Pool now has 0 tokens
      expect(await reward.poolBalance()).to.equal(0n);

      await expect(
        reward.connect(relay).claimReward(
          RELAY_DID_HASH, 101n, 5_000_000n, 0n, 1n, 100n, confirmations,
        ),
      ).to.be.revertedWith("Insufficient reward pool balance");
    });
  });

  // ─── DAO Admin ───────────────────────────────────────────────────

  describe("setRewardParams", function () {
    it("DAO can update params", async function () {
      await expect(
        reward.connect(admin).setRewardParams(200n, 2000n, 500_000n, 2n, 5000n),
      ).to.emit(reward, "RewardParamsUpdated")
        .withArgs(200n, 2000n, 500_000n, 2n, 5000n);

      const [baseRate, max, minB, minP, attBps] = await reward.getRewardParams();
      expect(baseRate).to.equal(200n);
      expect(max).to.equal(2000n);
      expect(minB).to.equal(500_000n);
      expect(minP).to.equal(2n);
      expect(attBps).to.equal(5000n);
    });

    it("outsider cannot update params", async function () {
      await expect(
        reward.connect(outsider).setRewardParams(200n, 2000n, 0n, 0n, 5000n),
      ).to.be.reverted;
    });
  });

  // ─── Pausable ────────────────────────────────────────────────────

  describe("pausable", function () {
    it("pauser can pause and unpause", async function () {
      await reward.connect(admin).pause();

      const confirmations = [peerConfirmation(PEER_A_HASH, 2_000_000n)];
      await expect(
        reward.connect(relay).claimReward(
          RELAY_DID_HASH, 1n, 2_000_000n, 0n, 1n, 100n, confirmations,
        ),
      ).to.be.reverted;

      await reward.connect(admin).unpause();

      // Should succeed after unpause
      await reward.connect(relay).claimReward(
        RELAY_DID_HASH, 1n, 2_000_000n, 0n, 1n, 100n, confirmations,
      );
      expect(await reward.getClaimCount(RELAY_DID_HASH)).to.equal(1n);
    });
  });
});
