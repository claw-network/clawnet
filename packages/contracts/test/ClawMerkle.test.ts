import { expect } from "chai";
import { ethers } from "hardhat";
import { MerkleTree } from "merkletreejs";
import type { ClawMerkleHarness } from "../typechain-types";

const { keccak256, toUtf8Bytes, AbiCoder } = ethers;
const coder = AbiCoder.defaultAbiCoder();

/** Mirror ClawMerkle.hashLeaf: keccak256(abi.encodePacked(keccak256(data))) */
function hashLeaf(data: string): string {
  return keccak256(keccak256(data));
}

describe("ClawMerkle", function () {
  let merkle: ClawMerkleHarness;

  beforeEach(async function () {
    const Factory = await ethers.getContractFactory("ClawMerkleHarness");
    merkle = (await Factory.deploy()) as unknown as ClawMerkleHarness;
    await merkle.waitForDeployment();
  });

  // ─── hashLeaf ──────────────────────────────────────────────────────

  describe("hashLeaf", function () {
    it("double-hashes data (second preimage protection)", async function () {
      const data = toUtf8Bytes("hello");
      const result = await merkle.hashLeaf(data);
      // keccak256(abi.encodePacked(keccak256("hello")))
      const expected = keccak256(keccak256(data));
      expect(result).to.equal(expected);
    });

    it("different data produces different leaves", async function () {
      const a = await merkle.hashLeaf(toUtf8Bytes("alpha"));
      const b = await merkle.hashLeaf(toUtf8Bytes("beta"));
      expect(a).to.not.equal(b);
    });
  });

  // ─── verify + processProof ─────────────────────────────────────────

  describe("verify & processProof", function () {
    let tree: InstanceType<typeof MerkleTree>;
    let leaves: string[];
    let root: string;

    beforeEach(function () {
      // Build 4-leaf tree with double-hashed leaves
      const rawData = ["leaf-1", "leaf-2", "leaf-3", "leaf-4"];
      leaves = rawData.map((d) => hashLeaf(toUtf8Bytes(d)));
      tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
      root = tree.getHexRoot();
    });

    it("verifies a valid inclusion proof", async function () {
      const leaf = leaves[1];
      const proof = tree.getHexProof(leaf);
      expect(await merkle.verify(proof, root, leaf)).to.be.true;
    });

    it("rejects proof for leaf not in tree", async function () {
      const badLeaf = hashLeaf(toUtf8Bytes("not-in-tree"));
      const proof = tree.getHexProof(leaves[0]);
      expect(await merkle.verify(proof, root, badLeaf)).to.be.false;
    });

    it("rejects proof against wrong root", async function () {
      const leaf = leaves[0];
      const proof = tree.getHexProof(leaf);
      const wrongRoot = keccak256(toUtf8Bytes("wrong"));
      expect(await merkle.verify(proof, wrongRoot, leaf)).to.be.false;
    });

    it("verifies empty proof for single-leaf tree", async function () {
      const singleLeaf = hashLeaf(toUtf8Bytes("only"));
      const singleTree = new MerkleTree([singleLeaf], keccak256, { sortPairs: true });
      const singleRoot = singleTree.getHexRoot();
      // Single leaf = root, proof is empty
      expect(await merkle.verify([], singleRoot, singleLeaf)).to.be.true;
    });

    it("processProof reconstructs the correct root", async function () {
      const leaf = leaves[2];
      const proof = tree.getHexProof(leaf);
      const computed = await merkle.processProof(proof, leaf);
      expect(computed).to.equal(root);
    });
  });

  // ─── deliverableLeaf ──────────────────────────────────────────────

  describe("deliverableLeaf", function () {
    it("matches off-chain computed leaf", async function () {
      const contractId = keccak256(toUtf8Bytes("contract-42"));
      const milestoneIndex = 2n;
      const contentHash = keccak256(toUtf8Bytes("ipfs://Qm..."));

      const onChain = await merkle.deliverableLeaf(contractId, milestoneIndex, contentHash);

      // Mirror: hashLeaf(abi.encode(contractId, milestoneIndex, contentHash))
      const encoded = coder.encode(
        ["bytes32", "uint256", "bytes32"],
        [contractId, milestoneIndex, contentHash],
      );
      const expected = hashLeaf(encoded);
      expect(onChain).to.equal(expected);
    });

    it("can be verified in a Merkle tree", async function () {
      const contractId = keccak256(toUtf8Bytes("contract-1"));
      const contentHashes = ["file-a", "file-b", "file-c", "file-d"];

      // Build leaves for 4 milestones
      const leaves = await Promise.all(
        contentHashes.map(async (ch, i) => {
          const h = keccak256(toUtf8Bytes(ch));
          return merkle.deliverableLeaf(contractId, i, h);
        }),
      );

      const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
      const root = tree.getHexRoot();

      // Verify milestone 2
      const target = leaves[2];
      const proof = tree.getHexProof(target);
      expect(await merkle.verify(proof, root, target)).to.be.true;
    });
  });

  // ─── reviewLeaf ───────────────────────────────────────────────────

  describe("reviewLeaf", function () {
    it("matches off-chain computed leaf", async function () {
      const reviewerId = keccak256(toUtf8Bytes("did:claw:reviewer"));
      const agentDIDHash = keccak256(toUtf8Bytes("did:claw:agent"));
      const epoch = 5n;
      const score = 850;
      const commentHash = keccak256(toUtf8Bytes("great work"));

      const onChain = await merkle.reviewLeaf(reviewerId, agentDIDHash, epoch, score, commentHash);

      const encoded = coder.encode(
        ["bytes32", "bytes32", "uint64", "uint16", "bytes32"],
        [reviewerId, agentDIDHash, epoch, score, commentHash],
      );
      const expected = hashLeaf(encoded);
      expect(onChain).to.equal(expected);
    });

    it("can be verified in a Merkle tree", async function () {
      const agentDIDHash = keccak256(toUtf8Bytes("did:claw:agent"));
      const epoch = 1n;

      // Build leaves for 3 reviews
      const leaves = await Promise.all(
        [0, 1, 2].map(async (i) => {
          const reviewerId = keccak256(toUtf8Bytes(`reviewer-${i}`));
          const commentHash = keccak256(toUtf8Bytes(`comment-${i}`));
          return merkle.reviewLeaf(reviewerId, agentDIDHash, epoch, (800 + i * 50), commentHash);
        }),
      );

      const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
      const root = tree.getHexRoot();

      // Verify review 1
      const proof = tree.getHexProof(leaves[1]);
      expect(await merkle.verify(proof, root, leaves[1])).to.be.true;

      // Wrong leaf fails
      const fakeLeaf = keccak256(toUtf8Bytes("fake"));
      expect(await merkle.verify(proof, root, fakeLeaf)).to.be.false;
    });
  });
});
