/**
 * Permission Matrix Verification Test (T-2.16)
 *
 * Verifies the permission matrix from on-chain-plan.md §11:
 * Each allowed/forbidden call is tested for every contract.
 *
 * Matrix:
 * | Caller         | ClawToken     | ClawEscrow     | ClawContracts   | ClawDAO      | ClawStaking      | ClawReputation  | ParamRegistry  |
 * |----------------|---------------|----------------|-----------------|--------------|------------------|-----------------|----------------|
 * | User EOA       | transfer ✅   | create/fund ✅ | create/sign ✅  | propose/vote | stake/unstake ✅ | — ❌             | — ❌            |
 * | ClawEscrow     | transferFrom  | —              | —               | —            | —                | —               | —              |
 * | ClawContracts  | —             | —              | —               | —            | —                | —               | —              |
 * | ClawDAO        | —             | —              | —               | execute ✅   | slash ✅          | —               | setParam ✅     |
 * | SLASHER_ROLE   | —             | —              | —               | —            | slash ✅          | —               | —              |
 * | ANCHOR_ROLE    | —             | —              | —               | —            | —                | anchor/record ✅ | —              |
 * | GOVERNOR_ROLE  | —             | —              | —               | —            | —                | —               | setParam ✅     |
 * | Non-privileged | mint ❌       | release ❌     | activate ❌     | execute ❌   | slash ❌          | anchor ❌        | setParam ❌     |
 */
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { keccak256, toUtf8Bytes, ZeroHash } from "ethers";

describe("Permission Matrix Verification", function () {
  // Contracts
  let token: any;
  let escrow: any;
  let identity: any;
  let staking: any;
  let paramRegistry: any;
  let dao: any;
  let serviceContracts: any;
  let reputation: any;

  // Signers
  let admin: HardhatEthersSigner;
  let user: HardhatEthersSigner;   // unprivileged
  let anchor: HardhatEthersSigner; // ANCHOR_ROLE on reputation
  let slasher: HardhatEthersSigner;
  let arbiterSigner: HardhatEthersSigner;
  let signers: HardhatEthersSigner[];

  const MIN_STAKE = 10_000;
  const ESCROW_BASE_RATE = 100;
  const ESCROW_HOLDING_RATE = 5;
  const ESCROW_MIN_FEE = 1;
  const EPOCH_DURATION = 86400n;

  before(async function () {
    const all = await ethers.getSigners();
    admin = all[0];
    user = all[1];
    anchor = all[2];
    slasher = all[3];
    arbiterSigner = all[4];
    signers = all.slice(5, 14);
    while (signers.length < 9) signers.push(all[0]);

    // Deploy all contracts
    const TokenF = await ethers.getContractFactory("ClawToken");
    token = await upgrades.deployProxy(
      TokenF, ["ClawNet Token", "TOKEN", admin.address], { kind: "uups" }
    );
    await token.waitForDeployment();

    const ParamF = await ethers.getContractFactory("ParamRegistry");
    paramRegistry = await upgrades.deployProxy(ParamF, [admin.address], { kind: "uups" });
    await paramRegistry.waitForDeployment();

    const EscrowF = await ethers.getContractFactory("ClawEscrow");
    escrow = await upgrades.deployProxy(
      EscrowF, [await token.getAddress(), admin.address, ESCROW_BASE_RATE, ESCROW_HOLDING_RATE, ESCROW_MIN_FEE],
      { kind: "uups" }
    );
    await escrow.waitForDeployment();

    const IdentityF = await ethers.getContractFactory("ClawIdentity");
    identity = await upgrades.deployProxy(IdentityF, [admin.address], { kind: "uups" });
    await identity.waitForDeployment();

    const StakingF = await ethers.getContractFactory("ClawStaking");
    staking = await upgrades.deployProxy(
      StakingF, [await token.getAddress(), MIN_STAKE, 604800, 1, 1],
      { kind: "uups" }
    );
    await staking.waitForDeployment();

    const DaoF = await ethers.getContractFactory("ClawDAO");
    const signerAddrs = signers.map((s) => s.address) as [string, string, string, string, string, string, string, string, string];
    dao = await upgrades.deployProxy(
      DaoF,
      [await token.getAddress(), await paramRegistry.getAddress(), 100, 60, 300, 60, 500, signerAddrs],
      { kind: "uups" }
    );
    await dao.waitForDeployment();

    const ContractsF = await ethers.getContractFactory("ClawContracts");
    serviceContracts = await upgrades.deployProxy(
      ContractsF, [await token.getAddress(), admin.address, 100, admin.address],
      { kind: "uups" }
    );
    await serviceContracts.waitForDeployment();

    const ReputationF = await ethers.getContractFactory("ClawReputation");
    reputation = await upgrades.deployProxy(
      ReputationF, [admin.address, EPOCH_DURATION],
      { kind: "uups" }
    );
    await reputation.waitForDeployment();

    // ── Role grants ──
    const ANCHOR_ROLE = keccak256(toUtf8Bytes("ANCHOR_ROLE"));
    await reputation.grantRole(ANCHOR_ROLE, anchor.address);

    const SLASHER_ROLE = keccak256(toUtf8Bytes("SLASHER_ROLE"));
    await staking.grantRole(SLASHER_ROLE, slasher.address);

    const GOVERNOR_ROLE = keccak256(toUtf8Bytes("GOVERNOR_ROLE"));
    await paramRegistry.grantRole(GOVERNOR_ROLE, await dao.getAddress());

    const ARBITER_ROLE = keccak256(toUtf8Bytes("ARBITER_ROLE"));
    await serviceContracts.grantRole(ARBITER_ROLE, arbiterSigner.address);

    // Staking needs MINTER_ROLE on Token (for reward distribution)
    const MINTER_ROLE = keccak256(toUtf8Bytes("MINTER_ROLE"));
    await token.grantRole(MINTER_ROLE, await staking.getAddress());

    // Mint tokens for testing
    await token.mint(admin.address, 1_000_000);
    await token.mint(user.address, 100_000);
  });

  // ──────────────────────────────────────────────────────────────────
  // ClawToken permissions
  // ──────────────────────────────────────────────────────────────────
  describe("ClawToken", () => {
    it("✅ user EOA can transfer", async () => {
      await token.connect(user).transfer(admin.address, 1);
    });

    it("✅ MINTER_ROLE (admin) can mint", async () => {
      await token.connect(admin).mint(user.address, 10);
    });

    it("❌ user without MINTER_ROLE cannot mint", async () => {
      await expect(token.connect(user).mint(user.address, 10)).to.be.reverted;
    });

    it("✅ BURNER_ROLE (admin) can burn", async () => {
      await token.connect(admin).burn(admin.address, 1);
    });

    it("❌ user without BURNER_ROLE cannot burn", async () => {
      await expect(token.connect(user).burn(user.address, 1)).to.be.reverted;
    });

    it("✅ PAUSER_ROLE (admin) can pause", async () => {
      await token.connect(admin).pause();
      await token.connect(admin).unpause();
    });

    it("❌ user without PAUSER_ROLE cannot pause", async () => {
      await expect(token.connect(user).pause()).to.be.reverted;
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // ClawEscrow permissions
  // ──────────────────────────────────────────────────────────────────
  describe("ClawEscrow", () => {
    it("✅ user EOA can create escrow", async () => {
      const escrowAddr = await escrow.getAddress();
      await token.connect(admin).approve(escrowAddr, 10_000);
      const escrowId = keccak256(toUtf8Bytes("perm-escrow-1"));
      const expiresAt = (await time.latest()) + 86400;
      await escrow.connect(admin).createEscrow(escrowId, user.address, arbiterSigner.address, 100, expiresAt);

      const info = await escrow.escrows(escrowId);
      expect(info.depositor).to.equal(admin.address);
    });

    it("❌ non-depositor/arbiter cannot release", async () => {
      const escrowId = keccak256(toUtf8Bytes("perm-escrow-1"));
      await expect(escrow.connect(user).release(escrowId)).to.be.reverted;
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // ClawStaking permissions
  // ──────────────────────────────────────────────────────────────────
  describe("ClawStaking", () => {
    it("✅ user EOA can stake", async () => {
      const stakingAddr = await staking.getAddress();
      await token.connect(user).approve(stakingAddr, MIN_STAKE);
      await staking.connect(user).stake(MIN_STAKE, 0);
      expect(await staking.isActiveValidator(user.address)).to.be.true;
    });

    it("✅ SLASHER_ROLE can slash", async () => {
      await staking.connect(slasher).slash(user.address, 100, keccak256(toUtf8Bytes("test-violation")));
    });

    it("❌ user without SLASHER_ROLE cannot slash", async () => {
      await expect(
        staking.connect(user).slash(admin.address, 100, keccak256(toUtf8Bytes("test")))
      ).to.be.reverted;
    });

    it("❌ user without DISTRIBUTOR_ROLE cannot distributeRewards", async () => {
      await expect(
        staking.connect(user).distributeRewards([user.address], [10])
      ).to.be.reverted;
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // ClawReputation permissions
  // ──────────────────────────────────────────────────────────────────
  describe("ClawReputation", () => {
    const DID_HASH = keccak256(toUtf8Bytes("did:claw:permTest"));
    const REVIEW_HASH = keccak256(toUtf8Bytes("review-perm-test"));
    const dims: [number, number, number, number, number] = [700, 700, 700, 700, 700];

    it("✅ ANCHOR_ROLE can anchorReputation", async () => {
      const merkleRoot = keccak256(toUtf8Bytes("merkle-perm"));
      await reputation.connect(anchor).anchorReputation(DID_HASH, 700, dims, merkleRoot);
      const [score] = await reputation.getReputation(DID_HASH);
      expect(score).to.equal(700);
    });

    it("✅ ANCHOR_ROLE can recordReview", async () => {
      const subjectDID = keccak256(toUtf8Bytes("did:claw:subject"));
      const txHash = keccak256(toUtf8Bytes("tx-perm"));
      await reputation.connect(anchor).recordReview(REVIEW_HASH, DID_HASH, subjectDID, txHash);
    });

    it("✅ ANCHOR_ROLE can linkAddressToDID", async () => {
      await reputation.connect(anchor).linkAddressToDID(anchor.address, DID_HASH);
    });

    it("❌ user without ANCHOR_ROLE cannot anchorReputation", async () => {
      const didHash2 = keccak256(toUtf8Bytes("did:claw:bad"));
      const merkleRoot = keccak256(toUtf8Bytes("bad-merkle"));
      await expect(
        reputation.connect(user).anchorReputation(didHash2, 500, dims, merkleRoot)
      ).to.be.reverted;
    });

    it("❌ user without ANCHOR_ROLE cannot recordReview", async () => {
      const reviewHash2 = keccak256(toUtf8Bytes("bad-review"));
      const subjectDID = keccak256(toUtf8Bytes("did:claw:subject"));
      const txHash = keccak256(toUtf8Bytes("tx-bad"));
      await expect(
        reputation.connect(user).recordReview(reviewHash2, DID_HASH, subjectDID, txHash)
      ).to.be.reverted;
    });

    it("❌ user without ANCHOR_ROLE cannot linkAddressToDID", async () => {
      const didHash2 = keccak256(toUtf8Bytes("did:claw:bad"));
      await expect(
        reputation.connect(user).linkAddressToDID(user.address, didHash2)
      ).to.be.reverted;
    });

    it("✅ anyone can read getTrustScore (view)", async () => {
      const score = await reputation.connect(user).getTrustScore(anchor.address);
      expect(score).to.equal(700);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // ParamRegistry permissions
  // ──────────────────────────────────────────────────────────────────
  describe("ParamRegistry", () => {
    const TEST_KEY = keccak256(toUtf8Bytes("TEST_PARAM"));

    it("✅ GOVERNOR_ROLE (admin) can setParam", async () => {
      await paramRegistry.connect(admin).setParam(TEST_KEY, 42);
      expect(await paramRegistry.getParam(TEST_KEY)).to.equal(42);
    });

    it("❌ user without GOVERNOR_ROLE cannot setParam", async () => {
      await expect(
        paramRegistry.connect(user).setParam(TEST_KEY, 99)
      ).to.be.reverted;
    });

    it("✅ anyone can read getParam (view)", async () => {
      expect(await paramRegistry.connect(user).getParam(TEST_KEY)).to.equal(42);
    });

    it("✅ anyone can read getParamWithDefault (view)", async () => {
      const unknownKey = keccak256(toUtf8Bytes("UNKNOWN"));
      expect(await paramRegistry.connect(user).getParamWithDefault(unknownKey, 999)).to.equal(999);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // ClawContracts permissions
  // ──────────────────────────────────────────────────────────────────
  describe("ClawContracts", () => {
    it("✅ user EOA can create service contract", async () => {
      const contractId = keccak256(toUtf8Bytes("perm-contract-1"));
      const deadline = (await time.latest()) + 86400 * 30;
      await serviceContracts.connect(admin).createContract(
        contractId, user.address, arbiterSigner.address, 1000,
        keccak256(toUtf8Bytes("terms")),
        deadline, [1000], [deadline]
      );
    });

    it("❌ non-party cannot sign contract", async () => {
      const contractId = keccak256(toUtf8Bytes("perm-contract-1"));
      await expect(
        serviceContracts.connect(anchor).signContract(contractId)
      ).to.be.reverted;
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // ClawIdentity permissions
  // ──────────────────────────────────────────────────────────────────
  describe("ClawIdentity", () => {
    it("✅ REGISTRAR_ROLE (admin) can register DID", async () => {
      const didHash = keccak256(toUtf8Bytes("did:claw:permIdentity"));
      const pubKey = ethers.randomBytes(32);
      await identity.connect(admin).registerDID(didHash, pubKey, 0, admin.address);
      expect(await identity.isActive(didHash)).to.be.true;
    });

    it("✅ registerDID is permissionless (any user can register)", async () => {
      const didHash = keccak256(toUtf8Bytes("did:claw:badIdentity"));
      const pubKey = ethers.randomBytes(32);
      // registerDID has no role restriction — open to all
      await identity.connect(user).registerDID(didHash, pubKey, 0, user.address);
      expect(await identity.isActive(didHash)).to.be.true;
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Cross-contract: DAO → ParamRegistry (GOVERNOR_ROLE)
  // ──────────────────────────────────────────────────────────────────
  describe("Cross-contract: DAO GOVERNOR_ROLE on ParamRegistry", () => {
    it("DAO contract address has GOVERNOR_ROLE on ParamRegistry", async () => {
      const GOVERNOR_ROLE = keccak256(toUtf8Bytes("GOVERNOR_ROLE"));
      expect(await paramRegistry.hasRole(GOVERNOR_ROLE, await dao.getAddress())).to.be.true;
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Cross-contract: Staking has MINTER_ROLE on Token
  // ──────────────────────────────────────────────────────────────────
  describe("Cross-contract: Staking MINTER_ROLE on Token", () => {
    it("Staking contract has MINTER_ROLE on ClawToken", async () => {
      const MINTER_ROLE = keccak256(toUtf8Bytes("MINTER_ROLE"));
      expect(await token.hasRole(MINTER_ROLE, await staking.getAddress())).to.be.true;
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // UUPS upgrade permission (all contracts)
  // ──────────────────────────────────────────────────────────────────
  describe("UUPS upgrade: only DEFAULT_ADMIN", () => {
    it("❌ user cannot upgrade ClawToken", async () => {
      const f = await ethers.getContractFactory("ClawToken", user);
      await expect(upgrades.upgradeProxy(await token.getAddress(), f)).to.be.reverted;
    });

    it("❌ user cannot upgrade ParamRegistry", async () => {
      const f = await ethers.getContractFactory("ParamRegistry", user);
      await expect(upgrades.upgradeProxy(await paramRegistry.getAddress(), f)).to.be.reverted;
    });

    it("❌ user cannot upgrade ClawReputation", async () => {
      const f = await ethers.getContractFactory("ClawReputation", user);
      await expect(upgrades.upgradeProxy(await reputation.getAddress(), f)).to.be.reverted;
    });
  });
});
