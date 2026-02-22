import { expect } from "chai";
import { ethers } from "hardhat";

describe("Ed25519Verifier", function () {
  let harness: any;

  const DID_HASH = ethers.keccak256(ethers.toUtf8Bytes("did:claw:z6MkTestUser"));
  const OLD_KEY_HASH = ethers.keccak256(ethers.randomBytes(32));
  const NEW_KEY_HASH = ethers.keccak256(ethers.randomBytes(32));
  const LINK_HASH = ethers.keccak256(ethers.toUtf8Bytes("twitter:12345"));

  before(async function () {
    const Factory = await ethers.getContractFactory("Ed25519VerifierHarness");
    harness = await Factory.deploy();
    await harness.waitForDeployment();
  });

  // ─── rotationPayload ───────────────────────────────────────────

  describe("rotationPayload", function () {
    it("should return deterministic hash for same inputs", async function () {
      const p1 = await harness.rotationPayload(DID_HASH, OLD_KEY_HASH, NEW_KEY_HASH);
      const p2 = await harness.rotationPayload(DID_HASH, OLD_KEY_HASH, NEW_KEY_HASH);
      expect(p1).to.equal(p2);
    });

    it("should match off-chain keccak256 computation", async function () {
      const expected = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes", "bytes", "bytes", "bytes", "bytes32", "bytes32", "bytes32"],
          [
            ethers.toUtf8Bytes("clawnet:"),
            ethers.toUtf8Bytes("rotate:"),
            ethers.toUtf8Bytes("v1"),
            ethers.toUtf8Bytes(":"),
            DID_HASH,
            OLD_KEY_HASH,
            NEW_KEY_HASH,
          ]
        )
      );
      const result = await harness.rotationPayload(DID_HASH, OLD_KEY_HASH, NEW_KEY_HASH);
      expect(result).to.equal(expected);
    });

    it("should differ when didHash differs", async function () {
      const other = ethers.keccak256(ethers.toUtf8Bytes("did:claw:z6MkOtherUser"));
      const p1 = await harness.rotationPayload(DID_HASH, OLD_KEY_HASH, NEW_KEY_HASH);
      const p2 = await harness.rotationPayload(other, OLD_KEY_HASH, NEW_KEY_HASH);
      expect(p1).to.not.equal(p2);
    });

    it("should differ when oldKeyHash differs", async function () {
      const otherOld = ethers.keccak256(ethers.randomBytes(32));
      const p1 = await harness.rotationPayload(DID_HASH, OLD_KEY_HASH, NEW_KEY_HASH);
      const p2 = await harness.rotationPayload(DID_HASH, otherOld, NEW_KEY_HASH);
      expect(p1).to.not.equal(p2);
    });

    it("should differ when newKeyHash differs", async function () {
      const otherNew = ethers.keccak256(ethers.randomBytes(32));
      const p1 = await harness.rotationPayload(DID_HASH, OLD_KEY_HASH, NEW_KEY_HASH);
      const p2 = await harness.rotationPayload(DID_HASH, OLD_KEY_HASH, otherNew);
      expect(p1).to.not.equal(p2);
    });
  });

  // ─── registrationPayload ──────────────────────────────────────

  describe("registrationPayload", function () {
    it("should return deterministic hash for same inputs", async function () {
      const [signer] = await ethers.getSigners();
      const p1 = await harness.registrationPayload(DID_HASH, signer.address);
      const p2 = await harness.registrationPayload(DID_HASH, signer.address);
      expect(p1).to.equal(p2);
    });

    it("should match off-chain computation", async function () {
      const [signer] = await ethers.getSigners();
      const expected = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes", "bytes", "bytes", "bytes", "bytes32", "address"],
          [
            ethers.toUtf8Bytes("clawnet:"),
            ethers.toUtf8Bytes("register:"),
            ethers.toUtf8Bytes("v1"),
            ethers.toUtf8Bytes(":"),
            DID_HASH,
            signer.address,
          ]
        )
      );
      const result = await harness.registrationPayload(DID_HASH, signer.address);
      expect(result).to.equal(expected);
    });

    it("should differ for different controllers", async function () {
      const [s1, s2] = await ethers.getSigners();
      const p1 = await harness.registrationPayload(DID_HASH, s1.address);
      const p2 = await harness.registrationPayload(DID_HASH, s2.address);
      expect(p1).to.not.equal(p2);
    });
  });

  // ─── linkPayload ──────────────────────────────────────────────

  describe("linkPayload", function () {
    it("should return deterministic hash for same inputs", async function () {
      const p1 = await harness.linkPayload(DID_HASH, LINK_HASH);
      const p2 = await harness.linkPayload(DID_HASH, LINK_HASH);
      expect(p1).to.equal(p2);
    });

    it("should match off-chain computation", async function () {
      const expected = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes", "bytes", "bytes", "bytes", "bytes32", "bytes32"],
          [
            ethers.toUtf8Bytes("clawnet:"),
            ethers.toUtf8Bytes("link:"),
            ethers.toUtf8Bytes("v1"),
            ethers.toUtf8Bytes(":"),
            DID_HASH,
            LINK_HASH,
          ]
        )
      );
      const result = await harness.linkPayload(DID_HASH, LINK_HASH);
      expect(result).to.equal(expected);
    });

    it("should differ for different linkHash", async function () {
      const other = ethers.keccak256(ethers.toUtf8Bytes("github:user123"));
      const p1 = await harness.linkPayload(DID_HASH, LINK_HASH);
      const p2 = await harness.linkPayload(DID_HASH, other);
      expect(p1).to.not.equal(p2);
    });
  });

  // ─── revocationPayload ────────────────────────────────────────

  describe("revocationPayload", function () {
    it("should return deterministic hash for same inputs", async function () {
      const p1 = await harness.revocationPayload(DID_HASH, 42);
      const p2 = await harness.revocationPayload(DID_HASH, 42);
      expect(p1).to.equal(p2);
    });

    it("should match off-chain computation", async function () {
      const nonce = 99n;
      const expected = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes", "bytes", "bytes", "bytes", "bytes32", "uint256"],
          [
            ethers.toUtf8Bytes("clawnet:"),
            ethers.toUtf8Bytes("revoke:"),
            ethers.toUtf8Bytes("v1"),
            ethers.toUtf8Bytes(":"),
            DID_HASH,
            nonce,
          ]
        )
      );
      const result = await harness.revocationPayload(DID_HASH, nonce);
      expect(result).to.equal(expected);
    });

    it("should differ for different nonces", async function () {
      const p1 = await harness.revocationPayload(DID_HASH, 1);
      const p2 = await harness.revocationPayload(DID_HASH, 2);
      expect(p1).to.not.equal(p2);
    });
  });

  // ─── verify (precompile stub) ─────────────────────────────────

  describe("verify (precompile — not yet deployed)", function () {
    it("should return false when precompile is not deployed", async function () {
      const message = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const signature = ethers.randomBytes(64);
      const publicKey = ethers.hexlify(ethers.randomBytes(32));
      const result = await harness.verify(message, signature, publicKey);
      expect(result).to.equal(false);
    });

    it("should revert with invalid signature length", async function () {
      const message = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const badSig = ethers.randomBytes(32); // wrong length
      const publicKey = ethers.hexlify(ethers.randomBytes(32));
      await expect(
        harness.verify(message, badSig, publicKey)
      ).to.be.revertedWith("Ed25519: invalid signature length");
    });
  });

  // ─── Domain separation ────────────────────────────────────────

  describe("domain separation", function () {
    it("rotation vs registration payloads should never collide", async function () {
      const [signer] = await ethers.getSigners();
      const rotation = await harness.rotationPayload(DID_HASH, OLD_KEY_HASH, NEW_KEY_HASH);
      const registration = await harness.registrationPayload(DID_HASH, signer.address);
      expect(rotation).to.not.equal(registration);
    });

    it("link vs revocation payloads should never collide", async function () {
      const link = await harness.linkPayload(DID_HASH, LINK_HASH);
      const revocation = await harness.revocationPayload(DID_HASH, 0);
      expect(link).to.not.equal(revocation);
    });
  });
});
