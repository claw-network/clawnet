import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { ClawIdentity } from "../typechain-types";

describe("ClawIdentity", function () {
  let identity: ClawIdentity;
  let admin: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;

  // Fake Ed25519 public keys (32 bytes each)
  const PUBKEY_1 = ethers.hexlify(ethers.randomBytes(32));
  const PUBKEY_2 = ethers.hexlify(ethers.randomBytes(32));
  const PUBKEY_3 = ethers.hexlify(ethers.randomBytes(32));

  // Sample DID hashes
  const DID_HASH_1 = ethers.keccak256(ethers.toUtf8Bytes("did:claw:z6MkUser1"));
  const DID_HASH_2 = ethers.keccak256(ethers.toUtf8Bytes("did:claw:z6MkUser2"));
  const DID_HASH_3 = ethers.keccak256(ethers.toUtf8Bytes("did:claw:z6MkUser3"));

  // KeyPurpose enum values
  const KP_AUTH = 0;        // Authentication
  const KP_ASSERTION = 1;   // Assertion
  const KP_KEY_AGR = 2;     // KeyAgreement
  const KP_RECOVERY = 3;    // Recovery

  async function deployFixture() {
    [admin, user1, user2, outsider] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("ClawIdentity");
    const proxy = await upgrades.deployProxy(
      Factory,
      [admin.address],
      { kind: "uups", initializer: "initialize" },
    );
    await proxy.waitForDeployment();
    identity = proxy as unknown as ClawIdentity;

    return { identity, admin, user1, user2, outsider };
  }

  beforeEach(async function () {
    await deployFixture();
  });

  // ─── Initialization ────────────────────────────────────────────────

  describe("Initialization", function () {
    it("should set admin roles correctly", async function () {
      const DEFAULT_ADMIN = ethers.ZeroHash;
      expect(await identity.hasRole(DEFAULT_ADMIN, admin.address)).to.be.true;
    });

    it("should set PAUSER_ROLE on admin", async function () {
      const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
      expect(await identity.hasRole(PAUSER_ROLE, admin.address)).to.be.true;
    });

    it("should set REGISTRAR_ROLE on admin", async function () {
      const REGISTRAR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REGISTRAR_ROLE"));
      expect(await identity.hasRole(REGISTRAR_ROLE, admin.address)).to.be.true;
    });

    it("should start with didCount = 0", async function () {
      expect(await identity.didCount()).to.equal(0);
    });

    it("should not allow re-initialization", async function () {
      await expect(
        identity.initialize(admin.address),
      ).to.be.revertedWithCustomError(identity, "InvalidInitialization");
    });
  });

  // ─── registerDID ───────────────────────────────────────────────────

  describe("registerDID", function () {
    it("should register a DID successfully", async function () {
      await identity.connect(user1).registerDID(DID_HASH_1, PUBKEY_1, KP_AUTH, user1.address);

      expect(await identity.isActive(DID_HASH_1)).to.be.true;
      expect(await identity.getController(DID_HASH_1)).to.equal(user1.address);
      expect(await identity.getActiveKey(DID_HASH_1)).to.equal(PUBKEY_1);
      expect(await identity.didCount()).to.equal(1);
    });

    it("should emit DIDRegistered event", async function () {
      await expect(
        identity.connect(user1).registerDID(DID_HASH_1, PUBKEY_1, KP_AUTH, user1.address),
      ).to.emit(identity, "DIDRegistered")
        .withArgs(DID_HASH_1, user1.address);
    });

    it("should store key record correctly", async function () {
      await identity.connect(user1).registerDID(DID_HASH_1, PUBKEY_1, KP_ASSERTION, user1.address);

      const keyHash = ethers.keccak256(PUBKEY_1);
      const [pubKey, addedAt, revokedAt, purpose] = await identity.getKeyRecord(DID_HASH_1, keyHash);
      expect(pubKey).to.equal(PUBKEY_1);
      expect(addedAt).to.be.greaterThan(0);
      expect(revokedAt).to.equal(0);
      expect(purpose).to.equal(KP_ASSERTION);
    });

    it("should use msg.sender as controller when evmAddress is zero", async function () {
      await identity.connect(user1).registerDID(DID_HASH_1, PUBKEY_1, KP_AUTH, ethers.ZeroAddress);
      expect(await identity.getController(DID_HASH_1)).to.equal(user1.address);
    });

    it("should revert on duplicate DID registration", async function () {
      await identity.connect(user1).registerDID(DID_HASH_1, PUBKEY_1, KP_AUTH, user1.address);
      await expect(
        identity.connect(user2).registerDID(DID_HASH_1, PUBKEY_2, KP_AUTH, user2.address),
      ).to.be.revertedWithCustomError(identity, "DIDAlreadyExists");
    });

    it("should revert on invalid public key length (< 32 bytes)", async function () {
      const shortKey = ethers.hexlify(ethers.randomBytes(16));
      await expect(
        identity.connect(user1).registerDID(DID_HASH_1, shortKey, KP_AUTH, user1.address),
      ).to.be.revertedWithCustomError(identity, "InvalidPublicKey");
    });

    it("should revert on invalid public key length (> 32 bytes)", async function () {
      const longKey = ethers.hexlify(ethers.randomBytes(64));
      await expect(
        identity.connect(user1).registerDID(DID_HASH_1, longKey, KP_AUTH, user1.address),
      ).to.be.revertedWithCustomError(identity, "InvalidPublicKey");
    });
  });

  // ─── rotateKey ─────────────────────────────────────────────────────

  describe("rotateKey", function () {
    beforeEach(async function () {
      await identity.connect(user1).registerDID(DID_HASH_1, PUBKEY_1, KP_AUTH, user1.address);
    });

    it("controller can rotate key successfully", async function () {
      const fakeProof = ethers.hexlify(ethers.randomBytes(64));
      await identity.connect(user1).rotateKey(DID_HASH_1, PUBKEY_2, fakeProof);

      expect(await identity.getActiveKey(DID_HASH_1)).to.equal(PUBKEY_2);
    });

    it("should revoke old key and add new key", async function () {
      const fakeProof = ethers.hexlify(ethers.randomBytes(64));
      const oldKeyHash = ethers.keccak256(PUBKEY_1);
      const newKeyHash = ethers.keccak256(PUBKEY_2);

      await identity.connect(user1).rotateKey(DID_HASH_1, PUBKEY_2, fakeProof);

      // Old key should be revoked
      const [, , revokedAt] = await identity.getKeyRecord(DID_HASH_1, oldKeyHash);
      expect(revokedAt).to.be.greaterThan(0);

      // New key should be active
      const [pubKey2, addedAt2, revokedAt2] = await identity.getKeyRecord(DID_HASH_1, newKeyHash);
      expect(pubKey2).to.equal(PUBKEY_2);
      expect(addedAt2).to.be.greaterThan(0);
      expect(revokedAt2).to.equal(0);
    });

    it("should emit KeyRotated event", async function () {
      const fakeProof = ethers.hexlify(ethers.randomBytes(64));
      const oldKeyHash = ethers.keccak256(PUBKEY_1);
      const newKeyHash = ethers.keccak256(PUBKEY_2);

      await expect(
        identity.connect(user1).rotateKey(DID_HASH_1, PUBKEY_2, fakeProof),
      ).to.emit(identity, "KeyRotated")
        .withArgs(DID_HASH_1, oldKeyHash, newKeyHash);
    });

    it("should revert if rotating to same key", async function () {
      const fakeProof = ethers.hexlify(ethers.randomBytes(64));
      await expect(
        identity.connect(user1).rotateKey(DID_HASH_1, PUBKEY_1, fakeProof),
      ).to.be.revertedWithCustomError(identity, "KeyAlreadyActive");
    });

    it("should revert if not controller", async function () {
      const fakeProof = ethers.hexlify(ethers.randomBytes(64));
      await expect(
        identity.connect(outsider).rotateKey(DID_HASH_1, PUBKEY_2, fakeProof),
      ).to.be.revertedWithCustomError(identity, "NotController");
    });

    it("should revert with invalid new key length", async function () {
      const shortKey = ethers.hexlify(ethers.randomBytes(16));
      const fakeProof = ethers.hexlify(ethers.randomBytes(64));
      await expect(
        identity.connect(user1).rotateKey(DID_HASH_1, shortKey, fakeProof),
      ).to.be.revertedWithCustomError(identity, "InvalidPublicKey");
    });

    it("should revert for revoked DID", async function () {
      await identity.connect(user1).revokeDID(DID_HASH_1);
      const fakeProof = ethers.hexlify(ethers.randomBytes(64));
      await expect(
        identity.connect(user1).rotateKey(DID_HASH_1, PUBKEY_2, fakeProof),
      ).to.be.revertedWithCustomError(identity, "DIDIsRevoked");
    });

    it("should revert for non-existent DID", async function () {
      const fakeProof = ethers.hexlify(ethers.randomBytes(64));
      const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("did:claw:nonexistent"));
      await expect(
        identity.connect(user1).rotateKey(fakeHash, PUBKEY_2, fakeProof),
      ).to.be.revertedWithCustomError(identity, "DIDNotFound");
    });
  });

  // ─── revokeDID ─────────────────────────────────────────────────────

  describe("revokeDID", function () {
    beforeEach(async function () {
      await identity.connect(user1).registerDID(DID_HASH_1, PUBKEY_1, KP_AUTH, user1.address);
    });

    it("controller can revoke DID", async function () {
      await identity.connect(user1).revokeDID(DID_HASH_1);
      expect(await identity.isActive(DID_HASH_1)).to.be.false;
    });

    it("should emit DIDRevoked event", async function () {
      await expect(identity.connect(user1).revokeDID(DID_HASH_1))
        .to.emit(identity, "DIDRevoked")
        .withArgs(DID_HASH_1);
    });

    it("should revoke the active key as well", async function () {
      const keyHash = ethers.keccak256(PUBKEY_1);
      await identity.connect(user1).revokeDID(DID_HASH_1);

      const [, , revokedAt] = await identity.getKeyRecord(DID_HASH_1, keyHash);
      expect(revokedAt).to.be.greaterThan(0);
    });

    it("non-controller cannot revoke", async function () {
      await expect(
        identity.connect(outsider).revokeDID(DID_HASH_1),
      ).to.be.revertedWithCustomError(identity, "NotController");
    });

    it("cannot revoke an already-revoked DID", async function () {
      await identity.connect(user1).revokeDID(DID_HASH_1);
      await expect(
        identity.connect(user1).revokeDID(DID_HASH_1),
      ).to.be.revertedWithCustomError(identity, "DIDIsRevoked");
    });
  });

  // ─── addPlatformLink ──────────────────────────────────────────────

  describe("addPlatformLink", function () {
    const LINK_HASH_1 = ethers.keccak256(ethers.toUtf8Bytes("github:user1"));
    const LINK_HASH_2 = ethers.keccak256(ethers.toUtf8Bytes("twitter:user1"));

    beforeEach(async function () {
      await identity.connect(user1).registerDID(DID_HASH_1, PUBKEY_1, KP_AUTH, user1.address);
    });

    it("controller can add platform link", async function () {
      await identity.connect(user1).addPlatformLink(DID_HASH_1, LINK_HASH_1);
      const links = await identity.getPlatformLinks(DID_HASH_1);
      expect(links.length).to.equal(1);
      expect(links[0]).to.equal(LINK_HASH_1);
    });

    it("can add multiple links", async function () {
      await identity.connect(user1).addPlatformLink(DID_HASH_1, LINK_HASH_1);
      await identity.connect(user1).addPlatformLink(DID_HASH_1, LINK_HASH_2);

      expect(await identity.getPlatformLinkCount(DID_HASH_1)).to.equal(2);
    });

    it("should emit PlatformLinked event", async function () {
      await expect(
        identity.connect(user1).addPlatformLink(DID_HASH_1, LINK_HASH_1),
      ).to.emit(identity, "PlatformLinked")
        .withArgs(DID_HASH_1, LINK_HASH_1);
    });

    it("should revert on zero linkHash", async function () {
      await expect(
        identity.connect(user1).addPlatformLink(DID_HASH_1, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(identity, "InvalidLinkHash");
    });

    it("non-controller cannot add link", async function () {
      await expect(
        identity.connect(outsider).addPlatformLink(DID_HASH_1, LINK_HASH_1),
      ).to.be.revertedWithCustomError(identity, "NotController");
    });
  });

  // ─── batchRegisterDID ─────────────────────────────────────────────

  describe("batchRegisterDID", function () {
    it("REGISTRAR can batch-register multiple DIDs", async function () {
      const hashes = [DID_HASH_1, DID_HASH_2, DID_HASH_3];
      const pubkeys = [PUBKEY_1, PUBKEY_2, PUBKEY_3];
      const purposes = [KP_AUTH, KP_ASSERTION, KP_KEY_AGR];
      const controllers = [user1.address, user2.address, outsider.address];

      await identity.connect(admin).batchRegisterDID(hashes, pubkeys, purposes, controllers);

      expect(await identity.didCount()).to.equal(3);
      expect(await identity.isActive(DID_HASH_1)).to.be.true;
      expect(await identity.isActive(DID_HASH_2)).to.be.true;
      expect(await identity.isActive(DID_HASH_3)).to.be.true;
      expect(await identity.getController(DID_HASH_1)).to.equal(user1.address);
      expect(await identity.getController(DID_HASH_2)).to.equal(user2.address);
    });

    it("should emit DIDRegistered event for each DID", async function () {
      const hashes = [DID_HASH_1, DID_HASH_2];
      const pubkeys = [PUBKEY_1, PUBKEY_2];
      const purposes = [KP_AUTH, KP_AUTH];
      const controllers = [user1.address, user2.address];

      const tx = identity.connect(admin).batchRegisterDID(hashes, pubkeys, purposes, controllers);
      await expect(tx).to.emit(identity, "DIDRegistered").withArgs(DID_HASH_1, user1.address);
      await expect(tx).to.emit(identity, "DIDRegistered").withArgs(DID_HASH_2, user2.address);
    });

    it("non-REGISTRAR cannot batch-register", async function () {
      const hashes = [DID_HASH_1];
      const pubkeys = [PUBKEY_1];
      const purposes = [KP_AUTH];
      const controllers = [user1.address];

      await expect(
        identity.connect(outsider).batchRegisterDID(hashes, pubkeys, purposes, controllers),
      ).to.be.revertedWithCustomError(identity, "AccessControlUnauthorizedAccount");
    });

    it("should revert on array length mismatch", async function () {
      const hashes = [DID_HASH_1, DID_HASH_2];
      const pubkeys = [PUBKEY_1]; // mismatch
      const purposes = [KP_AUTH, KP_AUTH];
      const controllers = [user1.address, user2.address];

      await expect(
        identity.connect(admin).batchRegisterDID(hashes, pubkeys, purposes, controllers),
      ).to.be.reverted;
    });

    it("should revert if any DID already exists in batch", async function () {
      await identity.connect(user1).registerDID(DID_HASH_1, PUBKEY_1, KP_AUTH, user1.address);

      const hashes = [DID_HASH_1, DID_HASH_2];
      const pubkeys = [PUBKEY_1, PUBKEY_2];
      const purposes = [KP_AUTH, KP_AUTH];
      const controllers = [user1.address, user2.address];

      await expect(
        identity.connect(admin).batchRegisterDID(hashes, pubkeys, purposes, controllers),
      ).to.be.revertedWithCustomError(identity, "DIDAlreadyExists");
    });
  });

  // ─── View functions ────────────────────────────────────────────────

  describe("View functions", function () {
    it("isActive returns false for unregistered DID", async function () {
      const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("did:claw:unknown"));
      expect(await identity.isActive(fakeHash)).to.be.false;
    });

    it("getController reverts for unregistered DID", async function () {
      const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("did:claw:unknown"));
      await expect(
        identity.getController(fakeHash),
      ).to.be.revertedWithCustomError(identity, "DIDNotFound");
    });

    it("getActiveKey reverts for unregistered DID", async function () {
      const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("did:claw:unknown"));
      await expect(
        identity.getActiveKey(fakeHash),
      ).to.be.revertedWithCustomError(identity, "DIDNotFound");
    });

    it("getPlatformLinks returns empty array for new DID", async function () {
      await identity.connect(user1).registerDID(DID_HASH_1, PUBKEY_1, KP_AUTH, user1.address);
      const links = await identity.getPlatformLinks(DID_HASH_1);
      expect(links.length).to.equal(0);
    });
  });

  // ─── Pause ─────────────────────────────────────────────────────────

  describe("Pause", function () {
    it("PAUSER can pause", async function () {
      await identity.connect(admin).pause();
      expect(await identity.paused()).to.be.true;
    });

    it("pause blocks registerDID", async function () {
      await identity.connect(admin).pause();
      await expect(
        identity.connect(user1).registerDID(DID_HASH_1, PUBKEY_1, KP_AUTH, user1.address),
      ).to.be.revertedWithCustomError(identity, "EnforcedPause");
    });

    it("pause blocks rotateKey", async function () {
      await identity.connect(user1).registerDID(DID_HASH_1, PUBKEY_1, KP_AUTH, user1.address);
      await identity.connect(admin).pause();

      const fakeProof = ethers.hexlify(ethers.randomBytes(64));
      await expect(
        identity.connect(user1).rotateKey(DID_HASH_1, PUBKEY_2, fakeProof),
      ).to.be.revertedWithCustomError(identity, "EnforcedPause");
    });

    it("pause blocks revokeDID", async function () {
      await identity.connect(user1).registerDID(DID_HASH_1, PUBKEY_1, KP_AUTH, user1.address);
      await identity.connect(admin).pause();

      await expect(
        identity.connect(user1).revokeDID(DID_HASH_1),
      ).to.be.revertedWithCustomError(identity, "EnforcedPause");
    });

    it("pause blocks addPlatformLink", async function () {
      await identity.connect(user1).registerDID(DID_HASH_1, PUBKEY_1, KP_AUTH, user1.address);
      await identity.connect(admin).pause();

      const linkHash = ethers.keccak256(ethers.toUtf8Bytes("github:test"));
      await expect(
        identity.connect(user1).addPlatformLink(DID_HASH_1, linkHash),
      ).to.be.revertedWithCustomError(identity, "EnforcedPause");
    });

    it("pause blocks batchRegisterDID", async function () {
      await identity.connect(admin).pause();
      await expect(
        identity.connect(admin).batchRegisterDID([DID_HASH_1], [PUBKEY_1], [KP_AUTH], [user1.address]),
      ).to.be.revertedWithCustomError(identity, "EnforcedPause");
    });

    it("unpause re-enables operations", async function () {
      await identity.connect(admin).pause();
      await identity.connect(admin).unpause();

      await identity.connect(user1).registerDID(DID_HASH_1, PUBKEY_1, KP_AUTH, user1.address);
      expect(await identity.isActive(DID_HASH_1)).to.be.true;
    });

    it("non-PAUSER cannot pause", async function () {
      await expect(
        identity.connect(outsider).pause(),
      ).to.be.revertedWithCustomError(identity, "AccessControlUnauthorizedAccount");
    });
  });

  // ─── Upgrade (UUPS) ───────────────────────────────────────────────

  describe("Upgrade (UUPS)", function () {
    it("admin can upgrade and state is preserved", async function () {
      await identity.connect(user1).registerDID(DID_HASH_1, PUBKEY_1, KP_AUTH, user1.address);

      const FactoryV2 = await ethers.getContractFactory("ClawIdentity");
      const upgraded = await upgrades.upgradeProxy(
        await identity.getAddress(), FactoryV2, { kind: "uups" },
      );

      const id2 = upgraded as unknown as ClawIdentity;
      expect(await id2.isActive(DID_HASH_1)).to.be.true;
      expect(await id2.getController(DID_HASH_1)).to.equal(user1.address);
      expect(await id2.getActiveKey(DID_HASH_1)).to.equal(PUBKEY_1);
      expect(await id2.didCount()).to.equal(1);
    });

    it("non-admin cannot upgrade", async function () {
      const FactoryV2 = await ethers.getContractFactory("ClawIdentity", outsider);
      await expect(
        upgrades.upgradeProxy(await identity.getAddress(), FactoryV2, { kind: "uups" }),
      ).to.be.revertedWithCustomError(identity, "AccessControlUnauthorizedAccount");
    });
  });
});
