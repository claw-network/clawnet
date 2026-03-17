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

  // Reward params chosen so that a 100 GiB claim with 10 peers is capped at MAX_PER_PERIOD.
  // With 2MB + 1 peer (byteFactor=18, peerFactor=1000, confirmRatio=10000):
  //   raw = 6000 * 18 * 1000 * 10000 / 10^12 = 1,080,000,000,000 / 10^12 = 1  > 0 ✓
  // With 100 GiB + 10 peers (byteFactor≈65781, peerFactor=10000, confirmRatio=10000):
  //   raw ≈ 6000 * 65781 * 10000 * 10000 / 10^12 ≈ 39,469 > 6000 = MAX_PER_PERIOD ✓
  const BASE_RATE = 6000n;
  const MAX_PER_PERIOD = 6000n;   // must be >= BASE_RATE ✓
  const MIN_BYTES = 1_000_000n;   // 1 MB
  const MIN_PEERS = 1n;
  const ATTACHMENT_WEIGHT_BPS = 3000n; // 0.3x

  // 100 GiB of relay traffic — large enough to exercise cap
  const LARGE_BYTES = 100n * (1n << 30n);   // 100 * 2^30 = 107,374,182,400

  const RELAY_DID_HASH = ethers.keccak256(ethers.toUtf8Bytes("did:claw:zRelay1"));
  const PEER_A_HASH = ethers.keccak256(ethers.toUtf8Bytes("did:claw:zPeerA"));
  const PEER_B_HASH = ethers.keccak256(ethers.toUtf8Bytes("did:claw:zPeerB"));

  // 100 × MAX_PER_PERIOD — enough to drain via 100 capped claims in the drain test
  const POOL_AMOUNT = 100n * MAX_PER_PERIOD; // = 600,000

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

    // P0 fix: register relay as the authorised operator for RELAY_DID_HASH
    await reward.connect(relay).registerRelayOperator(RELAY_DID_HASH);

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
    it("succeeds with valid claim (capped at MAX_PER_PERIOD)", async function () {
      // Use 100 GiB + 10 confirmers to guarantee the raw reward exceeds MAX_PER_PERIOD.
      const confirmations = [];
      for (let i = 0; i < 10; i++) {
        confirmations.push(peerConfirmation(
          ethers.keccak256(ethers.toUtf8Bytes(`peer${i}`)),
          LARGE_BYTES / 10n,
        ));
      }

      // The on-chain formula with these params yields raw >> MAX_PER_PERIOD;
      // the emitted rewardAmount must equal the cap.
      await expect(
        reward.connect(relay).claimReward(
          RELAY_DID_HASH, 1n,    // periodId
          LARGE_BYTES, 0n,       // messaging, attachment
          10n,                   // circuits
          confirmations,
        ),
      ).to.emit(reward, "RewardClaimed")
        .withArgs(RELAY_DID_HASH, 1n, MAX_PER_PERIOD, LARGE_BYTES, 10n);

      expect(await reward.lastClaimedPeriod(RELAY_DID_HASH)).to.equal(1n);
      expect(await reward.totalRewardsDistributed()).to.equal(MAX_PER_PERIOD);
      expect(await reward.getClaimCount(RELAY_DID_HASH)).to.equal(1n);
    });

    it("caps reward at maxRewardPerPeriod", async function () {
      // Use large data so raw computed reward >> MAX_PER_PERIOD
      const confirmations = [];
      for (let i = 0; i < 10; i++) {
        confirmations.push(peerConfirmation(
          ethers.keccak256(ethers.toUtf8Bytes(`peer${i}`)),
          LARGE_BYTES / 10n,
        ));
      }

      await reward.connect(relay).claimReward(
        RELAY_DID_HASH, 1n,
        LARGE_BYTES, 0n, 10n,
        confirmations,
      );

      // Raw reward >> MAX_PER_PERIOD; cap is applied.
      expect(await reward.totalRewardsDistributed()).to.equal(MAX_PER_PERIOD);

      const history = await reward.getClaimHistory(RELAY_DID_HASH);
      expect(history[0].rewardAmount).to.equal(MAX_PER_PERIOD);
    });

    it("rejects duplicate period", async function () {
      const confirmations = [peerConfirmation(PEER_A_HASH, 2_000_000n)];

      await reward.connect(relay).claimReward(
        RELAY_DID_HASH, 1n, 2_000_000n, 0n, 1n, confirmations,
      );

      await expect(
        reward.connect(relay).claimReward(
          RELAY_DID_HASH, 1n, 2_000_000n, 0n, 1n, confirmations,
        ),
      ).to.be.revertedWith("Period already claimed or invalid");
    });

    it("rejects non-monotonic period", async function () {
      const confirmations = [peerConfirmation(PEER_A_HASH, 2_000_000n)];

      await reward.connect(relay).claimReward(
        RELAY_DID_HASH, 5n, 2_000_000n, 0n, 1n, confirmations,
      );

      // Try period 3 (< 5) → should fail
      await expect(
        reward.connect(relay).claimReward(
          RELAY_DID_HASH, 3n, 2_000_000n, 0n, 1n, confirmations,
        ),
      ).to.be.revertedWith("Period already claimed or invalid");
    });

    it("rejects self-relay", async function () {
      const selfConfirmation = [peerConfirmation(RELAY_DID_HASH, 2_000_000n)];

      await expect(
        reward.connect(relay).claimReward(
          RELAY_DID_HASH, 1n, 2_000_000n, 0n, 1n, selfConfirmation,
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
          RELAY_DID_HASH, 1n, 2_000_000n, 0n, 1n, duplicates,
        ),
      ).to.be.revertedWith("Duplicate peer confirmation");
    });

    it("rejects below minimum bytes threshold", async function () {
      // 500 bytes < 1 MB threshold
      const confirmations = [peerConfirmation(PEER_A_HASH, 500n)];

      await expect(
        reward.connect(relay).claimReward(
          RELAY_DID_HASH, 1n, 500n, 0n, 1n, confirmations,
        ),
      ).to.be.revertedWith("Below minimum bytes threshold");
    });

    it("rejects below minimum peers threshold", async function () {
      // 0 peer confirmations < 1 min peers
      await expect(
        reward.connect(relay).claimReward(
          RELAY_DID_HASH, 1n, 5_000_000n, 0n, 1n, [],
        ),
      ).to.be.revertedWith("Not enough peer confirmations");
    });

    it("allows multiple peers", async function () {
      const confirmations = [
        peerConfirmation(PEER_A_HASH, 1_000_000n),
        peerConfirmation(PEER_B_HASH, 1_000_000n),
      ];

      await reward.connect(relay).claimReward(
        RELAY_DID_HASH, 1n, 2_000_000n, 0n, 5n, confirmations,
      );

      const history = await reward.getClaimHistory(RELAY_DID_HASH);
      expect(history[0].confirmedPeers).to.equal(2n);
      expect(history[0].confirmedBytes).to.equal(2_000_000n);
    });

    it("rejects when pool balance is insufficient", async function () {
      // Each call with LARGE_BYTES + 10 peers gets capped at MAX_PER_PERIOD (1000).
      // POOL_AMOUNT = 100 × MAX_PER_PERIOD, so 100 claims drain it to 0.
      const confirmations = [];
      for (let i = 0; i < 10; i++) {
        confirmations.push(peerConfirmation(
          ethers.keccak256(ethers.toUtf8Bytes(`drainpeer${i}`)),
          LARGE_BYTES / 10n,
        ));
      }

      for (let i = 1n; i <= 100n; i++) {
        await reward.connect(relay).claimReward(
          RELAY_DID_HASH, i, LARGE_BYTES, 0n, 10n, confirmations,
        );
      }

      // Pool now has 0 tokens
      expect(await reward.poolBalance()).to.equal(0n);

      await expect(
        reward.connect(relay).claimReward(
          RELAY_DID_HASH, 101n, LARGE_BYTES, 0n, 10n, confirmations,
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
          RELAY_DID_HASH, 1n, 2_000_000n, 0n, 1n, confirmations,
        ),
      ).to.be.reverted;

      await reward.connect(admin).unpause();

      // Should succeed after unpause
      await reward.connect(relay).claimReward(
        RELAY_DID_HASH, 1n, 2_000_000n, 0n, 1n, confirmations,
      );
      expect(await reward.getClaimCount(RELAY_DID_HASH)).to.equal(1n);
    });
  });
});

