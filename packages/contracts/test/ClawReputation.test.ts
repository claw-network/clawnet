import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
  ClawReputation,
  ClawReputation__factory,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { keccak256, toUtf8Bytes, solidityPackedKeccak256, ZeroHash } from "ethers";
import { MerkleTree } from "merkletreejs";

// ── Helpers ───────────────────────────────────────────────────────────

const EPOCH_DURATION = 86400n; // 24h
const DID_HASH_A = keccak256(toUtf8Bytes("did:claw:agentA"));
const DID_HASH_B = keccak256(toUtf8Bytes("did:claw:agentB"));
const DID_HASH_C = keccak256(toUtf8Bytes("did:claw:agentC"));
const REVIEW_HASH = keccak256(toUtf8Bytes("review-content-1"));
const REVIEW_HASH_2 = keccak256(toUtf8Bytes("review-content-2"));
const TX_HASH = keccak256(toUtf8Bytes("tx-hash-1"));
const MERKLE_ROOT = keccak256(toUtf8Bytes("merkle-root-placeholder"));
const EMPTY_MERKLE = ZeroHash;

const dims = (t: number, f: number, q: number, s: number, b: number): [number, number, number, number, number] => [t, f, q, s, b];

async function deployReputation(): Promise<{
  rep: ClawReputation;
  admin: HardhatEthersSigner;
  anchor: HardhatEthersSigner;
  user: HardhatEthersSigner;
  other: HardhatEthersSigner;
}> {
  const [admin, anchor, user, other] = await ethers.getSigners();
  const factory = (await ethers.getContractFactory("ClawReputation")) as ClawReputation__factory;
  const rep = (await upgrades.deployProxy(factory, [admin.address, EPOCH_DURATION], {
    kind: "uups",
  })) as unknown as ClawReputation;
  await rep.waitForDeployment();

  // Grant anchor role to dedicated anchor signer
  const ANCHOR_ROLE = await rep.ANCHOR_ROLE();
  await rep.connect(admin).grantRole(ANCHOR_ROLE, anchor.address);

  return { rep, admin, anchor, user, other };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("ClawReputation", () => {
  // ──────────────────────────────────────────────────────────────────
  // 1. Deployment / Initialization
  // ──────────────────────────────────────────────────────────────────
  describe("Initialization", () => {
    it("sets epoch duration correctly", async () => {
      const { rep } = await deployReputation();
      expect(await rep.epochDuration()).to.equal(EPOCH_DURATION);
    });

    it("admin has DEFAULT_ADMIN, ANCHOR_ROLE, PAUSER_ROLE", async () => {
      const { rep, admin } = await deployReputation();
      expect(await rep.hasRole(await rep.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      expect(await rep.hasRole(await rep.ANCHOR_ROLE(), admin.address)).to.be.true;
      expect(await rep.hasRole(await rep.PAUSER_ROLE(), admin.address)).to.be.true;
    });

    it("reverts if epochDuration is 0", async () => {
      const [admin] = await ethers.getSigners();
      const factory = await ethers.getContractFactory("ClawReputation");
      await expect(
        upgrades.deployProxy(factory, [admin.address, 0], { kind: "uups" })
      ).to.be.revertedWithCustomError(factory, "InvalidEpochDuration");
    });

    it("cannot initialize twice", async () => {
      const { rep, admin } = await deployReputation();
      await expect(rep.initialize(admin.address, EPOCH_DURATION)).to.be.reverted;
    });

    it("totalAgents starts at 0", async () => {
      const { rep } = await deployReputation();
      expect(await rep.totalAgents()).to.equal(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 2. anchorReputation
  // ──────────────────────────────────────────────────────────────────
  describe("anchorReputation", () => {
    it("anchors a snapshot and emits ReputationAnchored", async () => {
      const { rep, anchor } = await deployReputation();
      const tx = rep.connect(anchor).anchorReputation(
        DID_HASH_A, 800, dims(750, 820, 780, 900, 700), MERKLE_ROOT
      );
      await expect(tx)
        .to.emit(rep, "ReputationAnchored")
        .withArgs(DID_HASH_A, 0n, 800, MERKLE_ROOT);
    });

    it("stores latest snapshot correctly", async () => {
      const { rep, anchor } = await deployReputation();
      await rep.connect(anchor).anchorReputation(
        DID_HASH_A, 800, dims(750, 820, 780, 900, 700), MERKLE_ROOT
      );
      const snap = await rep.getLatestSnapshot(DID_HASH_A);
      expect(snap.agentDIDHash).to.equal(DID_HASH_A);
      expect(snap.overallScore).to.equal(800);
      expect(snap.transactionScore).to.equal(750);
      expect(snap.fulfillmentScore).to.equal(820);
      expect(snap.qualityScore).to.equal(780);
      expect(snap.socialScore).to.equal(900);
      expect(snap.behaviorScore).to.equal(700);
      expect(snap.merkleRoot).to.equal(MERKLE_ROOT);
    });

    it("stores snapshot in history by epoch", async () => {
      const { rep, anchor } = await deployReputation();
      await rep.connect(anchor).anchorReputation(
        DID_HASH_A, 800, dims(750, 820, 780, 900, 700), MERKLE_ROOT
      );
      const snap = await rep.getSnapshotHistory(DID_HASH_A, 0n);
      expect(snap.overallScore).to.equal(800);
    });

    it("increments totalAgents for new agent", async () => {
      const { rep, anchor } = await deployReputation();
      await rep.connect(anchor).anchorReputation(
        DID_HASH_A, 500, dims(500, 500, 500, 500, 500), MERKLE_ROOT
      );
      expect(await rep.totalAgents()).to.equal(1);
      // Re-anchor same agent → no increment
      await rep.connect(anchor).anchorReputation(
        DID_HASH_A, 600, dims(600, 600, 600, 600, 600), MERKLE_ROOT
      );
      expect(await rep.totalAgents()).to.equal(1);
      // New agent → increment
      await rep.connect(anchor).anchorReputation(
        DID_HASH_B, 700, dims(700, 700, 700, 700, 700), MERKLE_ROOT
      );
      expect(await rep.totalAgents()).to.equal(2);
    });

    it("getReputation returns overallScore and epoch", async () => {
      const { rep, anchor } = await deployReputation();
      await rep.connect(anchor).anchorReputation(
        DID_HASH_A, 850, dims(800, 900, 800, 850, 800), MERKLE_ROOT
      );
      const [score, epoch] = await rep.getReputation(DID_HASH_A);
      expect(score).to.equal(850);
      expect(epoch).to.equal(0n);
    });

    it("reverts if agentDIDHash is zero", async () => {
      const { rep, anchor } = await deployReputation();
      await expect(
        rep.connect(anchor).anchorReputation(ZeroHash, 500, dims(500, 500, 500, 500, 500), MERKLE_ROOT)
      ).to.be.revertedWithCustomError(rep, "InvalidDIDHash");
    });

    it("reverts if overallScore > 1000", async () => {
      const { rep, anchor } = await deployReputation();
      await expect(
        rep.connect(anchor).anchorReputation(DID_HASH_A, 1001, dims(500, 500, 500, 500, 500), MERKLE_ROOT)
      ).to.be.revertedWithCustomError(rep, "InvalidScore");
    });

    it("reverts if any dimension score > 1000", async () => {
      const { rep, anchor } = await deployReputation();
      await expect(
        rep.connect(anchor).anchorReputation(DID_HASH_A, 500, dims(500, 500, 1001, 500, 500), MERKLE_ROOT)
      ).to.be.revertedWithCustomError(rep, "InvalidScore");
    });

    it("allows score = 0 and score = 1000 (boundary)", async () => {
      const { rep, anchor } = await deployReputation();
      await rep.connect(anchor).anchorReputation(
        DID_HASH_A, 0, dims(0, 0, 0, 0, 0), MERKLE_ROOT
      );
      const [s1] = await rep.getReputation(DID_HASH_A);
      expect(s1).to.equal(0);

      await rep.connect(anchor).anchorReputation(
        DID_HASH_B, 1000, dims(1000, 1000, 1000, 1000, 1000), MERKLE_ROOT
      );
      const [s2] = await rep.getReputation(DID_HASH_B);
      expect(s2).to.equal(1000);
    });

    it("reverts if caller lacks ANCHOR_ROLE", async () => {
      const { rep, user } = await deployReputation();
      await expect(
        rep.connect(user).anchorReputation(DID_HASH_A, 500, dims(500, 500, 500, 500, 500), MERKLE_ROOT)
      ).to.be.reverted;
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 3. batchAnchorReputation
  // ──────────────────────────────────────────────────────────────────
  describe("batchAnchorReputation", () => {
    it("anchors multiple agents in one tx", async () => {
      const { rep, anchor } = await deployReputation();
      const tx = rep.connect(anchor).batchAnchorReputation(
        [DID_HASH_A, DID_HASH_B],
        [800, 600],
        [750, 820, 780, 900, 700, 600, 550, 650, 500, 580], // 5 dims × 2 agents, flat
        [MERKLE_ROOT, EMPTY_MERKLE]
      );
      await expect(tx).to.emit(rep, "ReputationAnchored").withArgs(DID_HASH_A, 0n, 800, MERKLE_ROOT);
      await expect(tx).to.emit(rep, "ReputationAnchored").withArgs(DID_HASH_B, 0n, 600, EMPTY_MERKLE);

      const [scoreA] = await rep.getReputation(DID_HASH_A);
      const [scoreB] = await rep.getReputation(DID_HASH_B);
      expect(scoreA).to.equal(800);
      expect(scoreB).to.equal(600);
      expect(await rep.totalAgents()).to.equal(2);
    });

    it("reverts on empty batch", async () => {
      const { rep, anchor } = await deployReputation();
      await expect(
        rep.connect(anchor).batchAnchorReputation([], [], [], [])
      ).to.be.revertedWithCustomError(rep, "EmptyBatch");
    });

    it("reverts on mismatched array lengths (scores)", async () => {
      const { rep, anchor } = await deployReputation();
      await expect(
        rep.connect(anchor).batchAnchorReputation(
          [DID_HASH_A, DID_HASH_B],
          [800], // wrong length
          [750, 820, 780, 900, 700, 600, 550, 650, 500, 580],
          [MERKLE_ROOT, EMPTY_MERKLE]
        )
      ).to.be.revertedWithCustomError(rep, "ArrayLengthMismatch");
    });

    it("reverts on mismatched array lengths (dimensionScoresFlat)", async () => {
      const { rep, anchor } = await deployReputation();
      await expect(
        rep.connect(anchor).batchAnchorReputation(
          [DID_HASH_A, DID_HASH_B],
          [800, 600],
          [750, 820, 780, 900, 700], // only 5 instead of 10
          [MERKLE_ROOT, EMPTY_MERKLE]
        )
      ).to.be.revertedWithCustomError(rep, "ArrayLengthMismatch");
    });

    it("reverts on mismatched array lengths (merkleRoots)", async () => {
      const { rep, anchor } = await deployReputation();
      await expect(
        rep.connect(anchor).batchAnchorReputation(
          [DID_HASH_A, DID_HASH_B],
          [800, 600],
          [750, 820, 780, 900, 700, 600, 550, 650, 500, 580],
          [MERKLE_ROOT] // wrong length
        )
      ).to.be.revertedWithCustomError(rep, "ArrayLengthMismatch");
    });

    it("reverts if caller lacks ANCHOR_ROLE", async () => {
      const { rep, user } = await deployReputation();
      await expect(
        rep.connect(user).batchAnchorReputation(
          [DID_HASH_A],
          [800],
          [750, 820, 780, 900, 700],
          [MERKLE_ROOT]
        )
      ).to.be.reverted;
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 4. recordReview
  // ──────────────────────────────────────────────────────────────────
  describe("recordReview", () => {
    it("records a review and emits ReviewRecorded", async () => {
      const { rep, anchor } = await deployReputation();
      const tx = rep.connect(anchor).recordReview(
        REVIEW_HASH, DID_HASH_A, DID_HASH_B, TX_HASH
      );
      await expect(tx)
        .to.emit(rep, "ReviewRecorded")
        .withArgs(REVIEW_HASH, DID_HASH_B, DID_HASH_A);
    });

    it("stores review anchor data", async () => {
      const { rep, anchor } = await deployReputation();
      await rep.connect(anchor).recordReview(REVIEW_HASH, DID_HASH_A, DID_HASH_B, TX_HASH);

      const review = await rep.verifyReview(REVIEW_HASH);
      expect(review.reviewerDIDHash).to.equal(DID_HASH_A);
      expect(review.subjectDIDHash).to.equal(DID_HASH_B);
      expect(review.txHash).to.equal(TX_HASH);
      expect(review.exists).to.be.true;
      expect(review.timestamp).to.be.gt(0);
    });

    it("reverts if reviewHash is zero", async () => {
      const { rep, anchor } = await deployReputation();
      await expect(
        rep.connect(anchor).recordReview(ZeroHash, DID_HASH_A, DID_HASH_B, TX_HASH)
      ).to.be.revertedWithCustomError(rep, "InvalidDIDHash");
    });

    it("reverts if subjectDIDHash is zero", async () => {
      const { rep, anchor } = await deployReputation();
      await expect(
        rep.connect(anchor).recordReview(REVIEW_HASH, DID_HASH_A, ZeroHash, TX_HASH)
      ).to.be.revertedWithCustomError(rep, "InvalidDIDHash");
    });

    it("reverts on duplicate review", async () => {
      const { rep, anchor } = await deployReputation();
      await rep.connect(anchor).recordReview(REVIEW_HASH, DID_HASH_A, DID_HASH_B, TX_HASH);
      await expect(
        rep.connect(anchor).recordReview(REVIEW_HASH, DID_HASH_A, DID_HASH_B, TX_HASH)
      ).to.be.revertedWithCustomError(rep, "ReviewAlreadyExists");
    });

    it("allows zero reviewerDIDHash (anonymous review)", async () => {
      const { rep, anchor } = await deployReputation();
      await rep.connect(anchor).recordReview(REVIEW_HASH, ZeroHash, DID_HASH_B, TX_HASH);
      const review = await rep.verifyReview(REVIEW_HASH);
      expect(review.reviewerDIDHash).to.equal(ZeroHash);
    });

    it("reverts if caller lacks ANCHOR_ROLE", async () => {
      const { rep, user } = await deployReputation();
      await expect(
        rep.connect(user).recordReview(REVIEW_HASH, DID_HASH_A, DID_HASH_B, TX_HASH)
      ).to.be.reverted;
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 5. verifyReview
  // ──────────────────────────────────────────────────────────────────
  describe("verifyReview", () => {
    it("reverts for non-existent review", async () => {
      const { rep } = await deployReputation();
      await expect(
        rep.verifyReview(REVIEW_HASH)
      ).to.be.revertedWithCustomError(rep, "ReviewNotFound");
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 6. linkAddressToDID + getTrustScore
  // ──────────────────────────────────────────────────────────────────
  describe("linkAddressToDID & getTrustScore", () => {
    it("links address to DID and emits event", async () => {
      const { rep, anchor, user } = await deployReputation();
      const tx = rep.connect(anchor).linkAddressToDID(user.address, DID_HASH_A);
      await expect(tx)
        .to.emit(rep, "AddressDIDLinked")
        .withArgs(user.address, DID_HASH_A);
    });

    it("getTrustScore returns overallScore for linked address", async () => {
      const { rep, anchor, user } = await deployReputation();
      await rep.connect(anchor).anchorReputation(
        DID_HASH_A, 850, dims(800, 900, 800, 850, 800), MERKLE_ROOT
      );
      await rep.connect(anchor).linkAddressToDID(user.address, DID_HASH_A);
      expect(await rep.getTrustScore(user.address)).to.equal(850);
    });

    it("getTrustScore returns 0 for unlinked address", async () => {
      const { rep, user } = await deployReputation();
      expect(await rep.getTrustScore(user.address)).to.equal(0);
    });

    it("getTrustScore returns 0 for linked address with no snapshots", async () => {
      const { rep, anchor, user } = await deployReputation();
      await rep.connect(anchor).linkAddressToDID(user.address, DID_HASH_A);
      expect(await rep.getTrustScore(user.address)).to.equal(0);
    });

    it("reverts linkAddressToDID with zero address", async () => {
      const { rep, anchor } = await deployReputation();
      await expect(
        rep.connect(anchor).linkAddressToDID(ethers.ZeroAddress, DID_HASH_A)
      ).to.be.revertedWithCustomError(rep, "InvalidDIDHash");
    });

    it("reverts linkAddressToDID with zero DID hash", async () => {
      const { rep, anchor, user } = await deployReputation();
      await expect(
        rep.connect(anchor).linkAddressToDID(user.address, ZeroHash)
      ).to.be.revertedWithCustomError(rep, "InvalidDIDHash");
    });

    it("reverts linkAddressToDID if caller lacks ANCHOR_ROLE", async () => {
      const { rep, user } = await deployReputation();
      await expect(
        rep.connect(user).linkAddressToDID(user.address, DID_HASH_A)
      ).to.be.reverted;
    });

    it("can re-link address to a different DID", async () => {
      const { rep, anchor, user } = await deployReputation();
      await rep.connect(anchor).anchorReputation(
        DID_HASH_A, 800, dims(800, 800, 800, 800, 800), MERKLE_ROOT
      );
      await rep.connect(anchor).anchorReputation(
        DID_HASH_B, 600, dims(600, 600, 600, 600, 600), MERKLE_ROOT
      );
      await rep.connect(anchor).linkAddressToDID(user.address, DID_HASH_A);
      expect(await rep.getTrustScore(user.address)).to.equal(800);

      await rep.connect(anchor).linkAddressToDID(user.address, DID_HASH_B);
      expect(await rep.getTrustScore(user.address)).to.equal(600);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 7. Epoch System
  // ──────────────────────────────────────────────────────────────────
  describe("Epoch system", () => {
    it("getCurrentEpoch starts at 0", async () => {
      const { rep } = await deployReputation();
      expect(await rep.getCurrentEpoch()).to.equal(0n);
    });

    it("epoch increments after epochDuration seconds", async () => {
      const { rep, anchor } = await deployReputation();
      await time.increase(Number(EPOCH_DURATION));
      expect(await rep.getCurrentEpoch()).to.equal(1n);

      // Anchor in epoch 1 and verify
      await rep.connect(anchor).anchorReputation(
        DID_HASH_A, 750, dims(700, 800, 750, 700, 750), MERKLE_ROOT
      );
      const [, epoch] = await rep.getReputation(DID_HASH_A);
      expect(epoch).to.equal(1n);
    });

    it("historical snapshots are preserved across epochs", async () => {
      const { rep, anchor } = await deployReputation();

      // Epoch 0
      await rep.connect(anchor).anchorReputation(
        DID_HASH_A, 500, dims(500, 500, 500, 500, 500), MERKLE_ROOT
      );

      // Epoch 1
      await time.increase(Number(EPOCH_DURATION));
      const merkle2 = keccak256(toUtf8Bytes("merkle-root-epoch1"));
      await rep.connect(anchor).anchorReputation(
        DID_HASH_A, 700, dims(700, 700, 700, 700, 700), merkle2
      );

      // Both epochs accessible
      const snap0 = await rep.getSnapshotHistory(DID_HASH_A, 0n);
      expect(snap0.overallScore).to.equal(500);

      const snap1 = await rep.getSnapshotHistory(DID_HASH_A, 1n);
      expect(snap1.overallScore).to.equal(700);

      // Latest reflects epoch 1
      const latest = await rep.getLatestSnapshot(DID_HASH_A);
      expect(latest.overallScore).to.equal(700);
      expect(latest.epoch).to.equal(1n);
    });

    it("overwriting snapshot in same epoch updates both latest and history", async () => {
      const { rep, anchor } = await deployReputation();
      await rep.connect(anchor).anchorReputation(
        DID_HASH_A, 500, dims(500, 500, 500, 500, 500), MERKLE_ROOT
      );
      await rep.connect(anchor).anchorReputation(
        DID_HASH_A, 800, dims(800, 800, 800, 800, 800), MERKLE_ROOT
      );
      const [score] = await rep.getReputation(DID_HASH_A);
      expect(score).to.equal(800);
      const snap = await rep.getSnapshotHistory(DID_HASH_A, 0n);
      expect(snap.overallScore).to.equal(800);
    });

    it("reverts getSnapshotHistory for non-existent epoch", async () => {
      const { rep, anchor } = await deployReputation();
      await rep.connect(anchor).anchorReputation(
        DID_HASH_A, 500, dims(500, 500, 500, 500, 500), MERKLE_ROOT
      );
      await expect(
        rep.getSnapshotHistory(DID_HASH_A, 99n)
      ).to.be.revertedWithCustomError(rep, "SnapshotNotFound");
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 8. Admin: setEpochDuration
  // ──────────────────────────────────────────────────────────────────
  describe("setEpochDuration", () => {
    it("admin can update epoch duration", async () => {
      const { rep, admin } = await deployReputation();
      const tx = rep.connect(admin).setEpochDuration(3600n);
      await expect(tx).to.emit(rep, "EpochDurationUpdated").withArgs(EPOCH_DURATION, 3600n);
      expect(await rep.epochDuration()).to.equal(3600n);
    });

    it("reverts if newDuration is 0", async () => {
      const { rep, admin } = await deployReputation();
      await expect(
        rep.connect(admin).setEpochDuration(0n)
      ).to.be.revertedWithCustomError(rep, "InvalidEpochDuration");
    });

    it("reverts if caller is not admin", async () => {
      const { rep, user } = await deployReputation();
      await expect(rep.connect(user).setEpochDuration(3600n)).to.be.reverted;
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 9. Pausable
  // ──────────────────────────────────────────────────────────────────
  describe("Pausable", () => {
    it("pauser can pause and unpause", async () => {
      const { rep, admin } = await deployReputation();
      await rep.connect(admin).pause();
      expect(await rep.paused()).to.be.true;
      await rep.connect(admin).unpause();
      expect(await rep.paused()).to.be.false;
    });

    it("reverts anchorReputation when paused", async () => {
      const { rep, admin, anchor } = await deployReputation();
      await rep.connect(admin).pause();
      await expect(
        rep.connect(anchor).anchorReputation(DID_HASH_A, 500, dims(500, 500, 500, 500, 500), MERKLE_ROOT)
      ).to.be.reverted;
    });

    it("reverts batchAnchorReputation when paused", async () => {
      const { rep, admin, anchor } = await deployReputation();
      await rep.connect(admin).pause();
      await expect(
        rep.connect(anchor).batchAnchorReputation(
          [DID_HASH_A], [500], [500, 500, 500, 500, 500], [MERKLE_ROOT]
        )
      ).to.be.reverted;
    });

    it("reverts recordReview when paused", async () => {
      const { rep, admin, anchor } = await deployReputation();
      await rep.connect(admin).pause();
      await expect(
        rep.connect(anchor).recordReview(REVIEW_HASH, DID_HASH_A, DID_HASH_B, TX_HASH)
      ).to.be.reverted;
    });

    it("reverts linkAddressToDID when paused", async () => {
      const { rep, admin, anchor, user } = await deployReputation();
      await rep.connect(admin).pause();
      await expect(
        rep.connect(anchor).linkAddressToDID(user.address, DID_HASH_A)
      ).to.be.reverted;
    });

    it("reverts pause if caller lacks PAUSER_ROLE", async () => {
      const { rep, user } = await deployReputation();
      await expect(rep.connect(user).pause()).to.be.reverted;
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 10. Merkle Proof Verification
  // ──────────────────────────────────────────────────────────────────
  describe("verifyMerkleProof", () => {
    it("verifies a valid Merkle proof", async () => {
      const { rep, anchor } = await deployReputation();

      // Build a small Merkle tree: 4 leaves
      const leaves = [
        keccak256(toUtf8Bytes("review-1")),
        keccak256(toUtf8Bytes("review-2")),
        keccak256(toUtf8Bytes("review-3")),
        keccak256(toUtf8Bytes("review-4")),
      ];
      const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
      const root = tree.getHexRoot();
      const leaf = leaves[1];
      const proof = tree.getHexProof(leaf);

      // Anchor with the correct Merkle root
      await rep.connect(anchor).anchorReputation(
        DID_HASH_A, 800, dims(800, 800, 800, 800, 800), root
      );

      expect(await rep.verifyMerkleProof(DID_HASH_A, 0n, leaf, proof)).to.be.true;
    });

    it("rejects an invalid Merkle proof", async () => {
      const { rep, anchor } = await deployReputation();

      const leaves = [
        keccak256(toUtf8Bytes("review-1")),
        keccak256(toUtf8Bytes("review-2")),
      ];
      const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
      const root = tree.getHexRoot();

      await rep.connect(anchor).anchorReputation(
        DID_HASH_A, 800, dims(800, 800, 800, 800, 800), root
      );

      const badLeaf = keccak256(toUtf8Bytes("not-in-tree"));
      const proof = tree.getHexProof(leaves[0]);
      expect(await rep.verifyMerkleProof(DID_HASH_A, 0n, badLeaf, proof)).to.be.false;
    });

    it("returns false for non-existent snapshot", async () => {
      const { rep } = await deployReputation();
      const leaf = keccak256(toUtf8Bytes("leaf"));
      expect(await rep.verifyMerkleProof(DID_HASH_A, 0n, leaf, [])).to.be.false;
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 11. UUPS Upgrade
  // ──────────────────────────────────────────────────────────────────
  describe("UUPS upgrade", () => {
    it("admin can upgrade", async () => {
      const { rep, admin } = await deployReputation();
      const factory = await ethers.getContractFactory("ClawReputation", admin);
      const upgraded = await upgrades.upgradeProxy(await rep.getAddress(), factory);
      expect(await upgraded.getAddress()).to.equal(await rep.getAddress());
    });

    it("non-admin cannot upgrade", async () => {
      const { rep, user } = await deployReputation();
      const factory = await ethers.getContractFactory("ClawReputation", user);
      await expect(
        upgrades.upgradeProxy(await rep.getAddress(), factory)
      ).to.be.reverted;
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 12. Edge cases
  // ──────────────────────────────────────────────────────────────────
  describe("Edge cases", () => {
    it("multiple agents in multiple epochs", async () => {
      const { rep, anchor } = await deployReputation();

      // Epoch 0: anchor A, B
      await rep.connect(anchor).batchAnchorReputation(
        [DID_HASH_A, DID_HASH_B],
        [500, 600],
        [500, 500, 500, 500, 500, 600, 600, 600, 600, 600],
        [MERKLE_ROOT, MERKLE_ROOT]
      );

      // Epoch 1: anchor A, C
      await time.increase(Number(EPOCH_DURATION));
      await rep.connect(anchor).batchAnchorReputation(
        [DID_HASH_A, DID_HASH_C],
        [700, 900],
        [700, 700, 700, 700, 700, 900, 900, 900, 900, 900],
        [MERKLE_ROOT, MERKLE_ROOT]
      );

      expect(await rep.totalAgents()).to.equal(3);

      // B is still at epoch 0 snapshot
      const [scoreB, epochB] = await rep.getReputation(DID_HASH_B);
      expect(scoreB).to.equal(600);
      expect(epochB).to.equal(0n);

      // A updated
      const [scoreA, epochA] = await rep.getReputation(DID_HASH_A);
      expect(scoreA).to.equal(700);
      expect(epochA).to.equal(1n);

      // C is new in epoch 1
      const [scoreC, epochC] = await rep.getReputation(DID_HASH_C);
      expect(scoreC).to.equal(900);
      expect(epochC).to.equal(1n);
    });

    it("records multiple different reviews", async () => {
      const { rep, anchor } = await deployReputation();
      await rep.connect(anchor).recordReview(REVIEW_HASH, DID_HASH_A, DID_HASH_B, TX_HASH);
      await rep.connect(anchor).recordReview(REVIEW_HASH_2, DID_HASH_B, DID_HASH_A, TX_HASH);

      const r1 = await rep.verifyReview(REVIEW_HASH);
      expect(r1.reviewerDIDHash).to.equal(DID_HASH_A);

      const r2 = await rep.verifyReview(REVIEW_HASH_2);
      expect(r2.reviewerDIDHash).to.equal(DID_HASH_B);
    });

    it("getReputation returns (0, 0) for unknown agent", async () => {
      const { rep } = await deployReputation();
      const [score, epoch] = await rep.getReputation(DID_HASH_A);
      expect(score).to.equal(0);
      expect(epoch).to.equal(0n);
    });
  });
});
