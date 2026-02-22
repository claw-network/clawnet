import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { ClawToken, ClawEscrow } from "../typechain-types";

describe("ClawEscrow", function () {
  let token: ClawToken;
  let escrow: ClawEscrow;
  let admin: HardhatEthersSigner;
  let depositor: HardhatEthersSigner;
  let beneficiary: HardhatEthersSigner;
  let arbiter: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;

  // Fee params: baseRate=100 (1%), holdingRate=5 (0.05%/day), minFee=1
  const BASE_RATE = 100n;
  const HOLDING_RATE = 5n;
  const MIN_FEE = 1n;

  const ESCROW_ID = ethers.keccak256(ethers.toUtf8Bytes("escrow-001"));
  const ESCROW_ID_2 = ethers.keccak256(ethers.toUtf8Bytes("escrow-002"));

  // Helper: deploy fresh token + escrow, mint tokens to depositor
  async function deployFixture() {
    [admin, depositor, beneficiary, arbiter, treasury, outsider] = await ethers.getSigners();

    // Deploy ClawToken
    const TokenFactory = await ethers.getContractFactory("ClawToken");
    const tokenProxy = await upgrades.deployProxy(
      TokenFactory,
      ["ClawNet Token", "TOKEN", admin.address],
      { kind: "uups", initializer: "initialize" },
    );
    await tokenProxy.waitForDeployment();
    token = tokenProxy as unknown as ClawToken;

    // Deploy ClawEscrow
    const EscrowFactory = await ethers.getContractFactory("ClawEscrow");
    const escrowProxy = await upgrades.deployProxy(
      EscrowFactory,
      [await token.getAddress(), treasury.address, BASE_RATE, HOLDING_RATE, MIN_FEE],
      { kind: "uups", initializer: "initialize" },
    );
    await escrowProxy.waitForDeployment();
    escrow = escrowProxy as unknown as ClawEscrow;

    // Mint 10000 Token to depositor
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    await token.connect(admin).grantRole(MINTER_ROLE, admin.address);
    await token.connect(admin).mint(depositor.address, 10000);

    return { token, escrow, admin, depositor, beneficiary, arbiter, treasury, outsider };
  }

  // Helper: get expiry N days from now
  async function expiryInDays(days: number): Promise<bigint> {
    const now = await time.latest();
    return BigInt(now) + BigInt(days * 86400);
  }

  // Helper: approve + create escrow with default params
  async function createDefaultEscrow(
    id: string = ethers.keccak256(ethers.toUtf8Bytes("escrow-001")),
    amount: bigint = 1000n,
    days: number = 7,
  ) {
    const exp = await expiryInDays(days);
    await token.connect(depositor).approve(await escrow.getAddress(), amount);
    return escrow.connect(depositor).createEscrow(id, beneficiary.address, arbiter.address, amount, exp);
  }

  beforeEach(async function () {
    await deployFixture();
  });

  // ─── Initialization ────────────────────────────────────────────────

  describe("Initialization", function () {
    it("should set token address correctly", async function () {
      expect(await escrow.token()).to.equal(await token.getAddress());
    });

    it("should set treasury address correctly", async function () {
      expect(await escrow.treasury()).to.equal(treasury.address);
    });

    it("should set fee parameters correctly", async function () {
      expect(await escrow.baseRate()).to.equal(BASE_RATE);
      expect(await escrow.holdingRate()).to.equal(HOLDING_RATE);
      expect(await escrow.minEscrowFee()).to.equal(MIN_FEE);
    });

    it("should not allow re-initialization", async function () {
      await expect(
        escrow.initialize(await token.getAddress(), treasury.address, 0, 0, 0),
      ).to.be.revertedWithCustomError(escrow, "InvalidInitialization");
    });
  });

  // ─── Create Escrow ─────────────────────────────────────────────────

  describe("createEscrow", function () {
    it("should create escrow successfully with correct state", async function () {
      const exp = await expiryInDays(7);
      await token.connect(depositor).approve(await escrow.getAddress(), 1000);
      await escrow.connect(depositor).createEscrow(ESCROW_ID, beneficiary.address, arbiter.address, 1000, exp);

      const e = await escrow.getEscrow(ESCROW_ID);
      expect(e.depositor).to.equal(depositor.address);
      expect(e.beneficiary).to.equal(beneficiary.address);
      expect(e.arbiter).to.equal(arbiter.address);
      expect(e.status).to.equal(0); // Active
    });

    it("should deduct fee from depositor and send to treasury", async function () {
      const exp = await expiryInDays(7);
      const amount = 1000n;
      // Fee: max(1, ceil(1000*100/10000) + ceil(1000*5*7/10000))
      //    = max(1, 10 + ceil(35000/10000))
      //    = max(1, 10 + 4) = 14
      const expectedFee = 14n;
      const expectedNet = amount - expectedFee;

      const treasuryBefore = await token.balanceOf(treasury.address);

      await token.connect(depositor).approve(await escrow.getAddress(), amount);
      await escrow.connect(depositor).createEscrow(ESCROW_ID, beneficiary.address, arbiter.address, amount, exp);

      const e = await escrow.getEscrow(ESCROW_ID);
      expect(e.amount).to.equal(expectedNet);

      const treasuryAfter = await token.balanceOf(treasury.address);
      expect(treasuryAfter - treasuryBefore).to.equal(expectedFee);
    });

    it("should emit EscrowCreated event", async function () {
      const exp = await expiryInDays(7);
      await token.connect(depositor).approve(await escrow.getAddress(), 1000);
      await expect(
        escrow.connect(depositor).createEscrow(ESCROW_ID, beneficiary.address, arbiter.address, 1000, exp),
      ).to.emit(escrow, "EscrowCreated");
    });

    it("should revert on duplicate escrowId", async function () {
      await createDefaultEscrow();
      const exp = await expiryInDays(7);
      await token.connect(depositor).approve(await escrow.getAddress(), 500);
      await expect(
        escrow.connect(depositor).createEscrow(ESCROW_ID, beneficiary.address, arbiter.address, 500, exp),
      ).to.be.revertedWithCustomError(escrow, "EscrowAlreadyExists");
    });

    it("should revert on zero amount", async function () {
      const exp = await expiryInDays(7);
      await expect(
        escrow.connect(depositor).createEscrow(ESCROW_ID, beneficiary.address, arbiter.address, 0, exp),
      ).to.be.revertedWithCustomError(escrow, "InvalidAmount");
    });

    it("should revert on past expiry", async function () {
      const pastExp = BigInt(await time.latest()) - 1n;
      await token.connect(depositor).approve(await escrow.getAddress(), 1000);
      await expect(
        escrow.connect(depositor).createEscrow(ESCROW_ID, beneficiary.address, arbiter.address, 1000, pastExp),
      ).to.be.revertedWithCustomError(escrow, "InvalidExpiry");
    });

    it("should revert when depositor has insufficient approval", async function () {
      const exp = await expiryInDays(7);
      // No approval
      await expect(
        escrow.connect(depositor).createEscrow(ESCROW_ID, beneficiary.address, arbiter.address, 1000, exp),
      ).to.be.reverted; // SafeERC20 revert
    });

    it("should revert when depositor has insufficient balance", async function () {
      const exp = await expiryInDays(7);
      await token.connect(depositor).approve(await escrow.getAddress(), 99999);
      await expect(
        escrow.connect(depositor).createEscrow(ESCROW_ID, beneficiary.address, arbiter.address, 99999, exp),
      ).to.be.reverted;
    });

    it("should revert on zero beneficiary address", async function () {
      const exp = await expiryInDays(7);
      await token.connect(depositor).approve(await escrow.getAddress(), 1000);
      await expect(
        escrow.connect(depositor).createEscrow(ESCROW_ID, ethers.ZeroAddress, arbiter.address, 1000, exp),
      ).to.be.revertedWithCustomError(escrow, "InvalidAddress");
    });

    it("should revert on zero arbiter address", async function () {
      const exp = await expiryInDays(7);
      await token.connect(depositor).approve(await escrow.getAddress(), 1000);
      await expect(
        escrow.connect(depositor).createEscrow(ESCROW_ID, beneficiary.address, ethers.ZeroAddress, 1000, exp),
      ).to.be.revertedWithCustomError(escrow, "InvalidAddress");
    });
  });

  // ─── Release ───────────────────────────────────────────────────────

  describe("release", function () {
    beforeEach(async function () {
      await createDefaultEscrow();
    });

    it("depositor can release to beneficiary", async function () {
      const e = await escrow.getEscrow(ESCROW_ID);
      const benBefore = await token.balanceOf(beneficiary.address);

      await escrow.connect(depositor).release(ESCROW_ID);

      const benAfter = await token.balanceOf(beneficiary.address);
      expect(benAfter - benBefore).to.equal(e.amount);

      const updated = await escrow.getEscrow(ESCROW_ID);
      expect(updated.status).to.equal(1); // Released
    });

    it("arbiter can release to beneficiary", async function () {
      await escrow.connect(arbiter).release(ESCROW_ID);
      const updated = await escrow.getEscrow(ESCROW_ID);
      expect(updated.status).to.equal(1); // Released
    });

    it("should emit EscrowReleased event", async function () {
      await expect(escrow.connect(depositor).release(ESCROW_ID))
        .to.emit(escrow, "EscrowReleased")
        .withArgs(ESCROW_ID, depositor.address);
    });

    it("beneficiary cannot release", async function () {
      await expect(
        escrow.connect(beneficiary).release(ESCROW_ID),
      ).to.be.revertedWithCustomError(escrow, "NotAuthorized");
    });

    it("outsider cannot release", async function () {
      await expect(
        escrow.connect(outsider).release(ESCROW_ID),
      ).to.be.revertedWithCustomError(escrow, "NotAuthorized");
    });

    it("cannot release an already-released escrow", async function () {
      await escrow.connect(depositor).release(ESCROW_ID);
      await expect(
        escrow.connect(depositor).release(ESCROW_ID),
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });

    it("cannot release a refunded escrow", async function () {
      await escrow.connect(beneficiary).refund(ESCROW_ID);
      await expect(
        escrow.connect(depositor).release(ESCROW_ID),
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  // ─── Refund ────────────────────────────────────────────────────────

  describe("refund", function () {
    beforeEach(async function () {
      await createDefaultEscrow();
    });

    it("beneficiary can refund to depositor", async function () {
      const e = await escrow.getEscrow(ESCROW_ID);
      const depBefore = await token.balanceOf(depositor.address);

      await escrow.connect(beneficiary).refund(ESCROW_ID);

      const depAfter = await token.balanceOf(depositor.address);
      expect(depAfter - depBefore).to.equal(e.amount);

      const updated = await escrow.getEscrow(ESCROW_ID);
      expect(updated.status).to.equal(2); // Refunded
    });

    it("arbiter can refund to depositor", async function () {
      await escrow.connect(arbiter).refund(ESCROW_ID);
      const updated = await escrow.getEscrow(ESCROW_ID);
      expect(updated.status).to.equal(2); // Refunded
    });

    it("depositor cannot refund", async function () {
      await expect(
        escrow.connect(depositor).refund(ESCROW_ID),
      ).to.be.revertedWithCustomError(escrow, "NotAuthorized");
    });

    it("outsider cannot refund", async function () {
      await expect(
        escrow.connect(outsider).refund(ESCROW_ID),
      ).to.be.revertedWithCustomError(escrow, "NotAuthorized");
    });

    it("should emit EscrowRefunded event", async function () {
      await expect(escrow.connect(beneficiary).refund(ESCROW_ID))
        .to.emit(escrow, "EscrowRefunded")
        .withArgs(ESCROW_ID, beneficiary.address);
    });
  });

  // ─── Expire ────────────────────────────────────────────────────────

  describe("expire", function () {
    beforeEach(async function () {
      await createDefaultEscrow();
    });

    it("should revert if escrow not expired yet", async function () {
      await expect(
        escrow.connect(outsider).expire(ESCROW_ID),
      ).to.be.revertedWithCustomError(escrow, "NotExpiredYet");
    });

    it("anyone can expire after deadline", async function () {
      // Fast-forward 8 days
      await time.increase(8 * 86400);

      const e = await escrow.getEscrow(ESCROW_ID);
      const depBefore = await token.balanceOf(depositor.address);

      await escrow.connect(outsider).expire(ESCROW_ID);

      const depAfter = await token.balanceOf(depositor.address);
      expect(depAfter - depBefore).to.equal(e.amount);

      const updated = await escrow.getEscrow(ESCROW_ID);
      expect(updated.status).to.equal(3); // Expired
    });

    it("should emit EscrowExpired event", async function () {
      await time.increase(8 * 86400);
      await expect(escrow.connect(outsider).expire(ESCROW_ID))
        .to.emit(escrow, "EscrowExpired")
        .withArgs(ESCROW_ID, outsider.address);
    });

    it("cannot expire a non-Active escrow", async function () {
      await escrow.connect(depositor).release(ESCROW_ID);
      await time.increase(8 * 86400);
      await expect(
        escrow.connect(outsider).expire(ESCROW_ID),
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  // ─── Dispute ───────────────────────────────────────────────────────

  describe("dispute", function () {
    beforeEach(async function () {
      await createDefaultEscrow();
    });

    it("depositor can dispute", async function () {
      await escrow.connect(depositor).dispute(ESCROW_ID);
      const e = await escrow.getEscrow(ESCROW_ID);
      expect(e.status).to.equal(4); // Disputed
    });

    it("beneficiary can dispute", async function () {
      await escrow.connect(beneficiary).dispute(ESCROW_ID);
      const e = await escrow.getEscrow(ESCROW_ID);
      expect(e.status).to.equal(4); // Disputed
    });

    it("arbiter cannot dispute", async function () {
      await expect(
        escrow.connect(arbiter).dispute(ESCROW_ID),
      ).to.be.revertedWithCustomError(escrow, "NotAuthorized");
    });

    it("outsider cannot dispute", async function () {
      await expect(
        escrow.connect(outsider).dispute(ESCROW_ID),
      ).to.be.revertedWithCustomError(escrow, "NotAuthorized");
    });

    it("should emit EscrowDisputed event", async function () {
      await expect(escrow.connect(depositor).dispute(ESCROW_ID))
        .to.emit(escrow, "EscrowDisputed")
        .withArgs(ESCROW_ID, depositor.address);
    });

    it("cannot dispute a non-Active escrow", async function () {
      await escrow.connect(depositor).release(ESCROW_ID);
      await expect(
        escrow.connect(depositor).dispute(ESCROW_ID),
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  // ─── Resolve ───────────────────────────────────────────────────────

  describe("resolve", function () {
    beforeEach(async function () {
      await createDefaultEscrow();
      await escrow.connect(depositor).dispute(ESCROW_ID);
    });

    it("arbiter resolves in favor of beneficiary", async function () {
      const e = await escrow.getEscrow(ESCROW_ID);
      const benBefore = await token.balanceOf(beneficiary.address);

      await escrow.connect(arbiter).resolve(ESCROW_ID, true);

      const benAfter = await token.balanceOf(beneficiary.address);
      expect(benAfter - benBefore).to.equal(e.amount);

      const updated = await escrow.getEscrow(ESCROW_ID);
      expect(updated.status).to.equal(1); // Released
    });

    it("arbiter resolves in favor of depositor", async function () {
      const e = await escrow.getEscrow(ESCROW_ID);
      const depBefore = await token.balanceOf(depositor.address);

      await escrow.connect(arbiter).resolve(ESCROW_ID, false);

      const depAfter = await token.balanceOf(depositor.address);
      expect(depAfter - depBefore).to.equal(e.amount);

      const updated = await escrow.getEscrow(ESCROW_ID);
      expect(updated.status).to.equal(2); // Refunded
    });

    it("depositor cannot resolve", async function () {
      await expect(
        escrow.connect(depositor).resolve(ESCROW_ID, true),
      ).to.be.revertedWithCustomError(escrow, "NotAuthorized");
    });

    it("beneficiary cannot resolve", async function () {
      await expect(
        escrow.connect(beneficiary).resolve(ESCROW_ID, true),
      ).to.be.revertedWithCustomError(escrow, "NotAuthorized");
    });

    it("cannot resolve a non-Disputed escrow", async function () {
      // Create another active escrow
      const exp = await expiryInDays(7);
      await token.connect(depositor).approve(await escrow.getAddress(), 500);
      await escrow.connect(depositor).createEscrow(ESCROW_ID_2, beneficiary.address, arbiter.address, 500, exp);

      await expect(
        escrow.connect(arbiter).resolve(ESCROW_ID_2, true),
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });

    it("should emit EscrowResolved event", async function () {
      await expect(escrow.connect(arbiter).resolve(ESCROW_ID, true))
        .to.emit(escrow, "EscrowResolved")
        .withArgs(ESCROW_ID, arbiter.address, true);
    });
  });

  // ─── Fund (top-up) ────────────────────────────────────────────────

  describe("fund", function () {
    beforeEach(async function () {
      await createDefaultEscrow();
    });

    it("anyone with tokens can fund an active escrow", async function () {
      // Mint tokens to outsider
      const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
      await token.connect(admin).grantRole(MINTER_ROLE, admin.address);
      await token.connect(admin).mint(outsider.address, 500);

      const eBefore = await escrow.getEscrow(ESCROW_ID);
      await token.connect(outsider).approve(await escrow.getAddress(), 200);
      await escrow.connect(outsider).fund(ESCROW_ID, 200);

      const eAfter = await escrow.getEscrow(ESCROW_ID);
      expect(eAfter.amount - eBefore.amount).to.equal(200);
    });

    it("should emit EscrowFunded event", async function () {
      await token.connect(depositor).approve(await escrow.getAddress(), 100);
      await expect(escrow.connect(depositor).fund(ESCROW_ID, 100))
        .to.emit(escrow, "EscrowFunded")
        .withArgs(ESCROW_ID, depositor.address, 100);
    });

    it("cannot fund zero amount", async function () {
      await expect(
        escrow.connect(depositor).fund(ESCROW_ID, 0),
      ).to.be.revertedWithCustomError(escrow, "InvalidAmount");
    });

    it("cannot fund a released escrow", async function () {
      await escrow.connect(depositor).release(ESCROW_ID);
      await token.connect(depositor).approve(await escrow.getAddress(), 100);
      await expect(
        escrow.connect(depositor).fund(ESCROW_ID, 100),
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  // ─── Fee calculation ──────────────────────────────────────────────

  describe("Fee calculation", function () {
    it("fee = max(minFee, ceil(amount*baseRate/10000) + ceil(amount*holdingRate*days/10000))", async function () {
      // amount=1000, days=7, baseRate=100, holdingRate=5
      // baseFee = ceil(1000*100/10000) = ceil(10) = 10
      // holdFee = ceil(1000*5*7/10000) = ceil(3.5) = 4
      // total = 14, > minFee(1) → 14
      expect(await escrow.calculateFee(1000, 7)).to.equal(14);
    });

    it("applies minFee when calculated fee is too low", async function () {
      // amount=10, days=1, baseRate=100, holdingRate=5
      // baseFee = ceil(10*100/10000) = ceil(0.1) = 1
      // holdFee = ceil(10*5*1/10000) = ceil(0.005) = 1
      // total = 2, > minFee(1) → 2
      // But for very small: amount=1, days=1
      // baseFee = ceil(1*100/10000) = ceil(0.01) = 1
      // holdFee = ceil(1*5*1/10000) = ceil(0.0005) = 1
      // total = 2 > 1 → 2
      // With amount=0 → fee = 0, but minFee=1 → 1
      // Actually _ceilDiv(0, b) = 0 so total=0, minFee=1 → 1
      // But we don't allow amount=0 in createEscrow so this is just the pure function
      expect(await escrow.calculateFee(0, 1)).to.equal(1);
    });

    it("fee for large amounts and long durations", async function () {
      // amount=10000, days=30
      // baseFee = ceil(10000*100/10000) = 100
      // holdFee = ceil(10000*5*30/10000) = ceil(150) = 150
      // total = 250
      expect(await escrow.calculateFee(10000, 30)).to.equal(250);
    });

    it("fee for 1 day holding", async function () {
      // amount=500, days=1
      // baseFee = ceil(500*100/10000) = ceil(5) = 5
      // holdFee = ceil(500*5*1/10000) = ceil(0.25) = 1
      // total = 6
      expect(await escrow.calculateFee(500, 1)).to.equal(6);
    });
  });

  // ─── Pause ────────────────────────────────────────────────────────

  describe("Pause", function () {
    it("PAUSER_ROLE can pause", async function () {
      await escrow.connect(admin).pause();
      expect(await escrow.paused()).to.be.true;
    });

    it("pause blocks createEscrow", async function () {
      await escrow.connect(admin).pause();
      const exp = await expiryInDays(7);
      await token.connect(depositor).approve(await escrow.getAddress(), 1000);
      await expect(
        escrow.connect(depositor).createEscrow(ESCROW_ID, beneficiary.address, arbiter.address, 1000, exp),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("pause blocks release", async function () {
      await createDefaultEscrow();
      await escrow.connect(admin).pause();
      await expect(
        escrow.connect(depositor).release(ESCROW_ID),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("pause blocks refund", async function () {
      await createDefaultEscrow();
      await escrow.connect(admin).pause();
      await expect(
        escrow.connect(beneficiary).refund(ESCROW_ID),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("pause blocks fund", async function () {
      await createDefaultEscrow();
      await escrow.connect(admin).pause();
      await token.connect(depositor).approve(await escrow.getAddress(), 100);
      await expect(
        escrow.connect(depositor).fund(ESCROW_ID, 100),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("pause blocks dispute", async function () {
      await createDefaultEscrow();
      await escrow.connect(admin).pause();
      await expect(
        escrow.connect(depositor).dispute(ESCROW_ID),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("pause blocks expire", async function () {
      await createDefaultEscrow();
      await time.increase(8 * 86400);
      await escrow.connect(admin).pause();
      await expect(
        escrow.connect(outsider).expire(ESCROW_ID),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("pause blocks resolve", async function () {
      await createDefaultEscrow();
      await escrow.connect(depositor).dispute(ESCROW_ID);
      await escrow.connect(admin).pause();
      await expect(
        escrow.connect(arbiter).resolve(ESCROW_ID, true),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("unpause re-enables operations", async function () {
      await createDefaultEscrow();
      await escrow.connect(admin).pause();
      await escrow.connect(admin).unpause();
      // Should work now
      await escrow.connect(depositor).release(ESCROW_ID);
      const e = await escrow.getEscrow(ESCROW_ID);
      expect(e.status).to.equal(1); // Released
    });

    it("non-PAUSER cannot pause", async function () {
      await expect(
        escrow.connect(outsider).pause(),
      ).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
    });
  });

  // ─── Upgrade ───────────────────────────────────────────────────────

  describe("Upgrade (UUPS)", function () {
    it("admin can upgrade and state is preserved", async function () {
      await createDefaultEscrow();
      const eBefore = await escrow.getEscrow(ESCROW_ID);

      const FactoryV2 = await ethers.getContractFactory("ClawEscrow");
      const upgraded = await upgrades.upgradeProxy(await escrow.getAddress(), FactoryV2, { kind: "uups" });

      const eAfter = await (upgraded as unknown as ClawEscrow).getEscrow(ESCROW_ID);
      expect(eAfter.depositor).to.equal(eBefore.depositor);
      expect(eAfter.amount).to.equal(eBefore.amount);
      expect(eAfter.status).to.equal(eBefore.status);
    });

    it("non-admin cannot upgrade", async function () {
      const FactoryV2 = await ethers.getContractFactory("ClawEscrow", outsider);
      await expect(
        upgrades.upgradeProxy(await escrow.getAddress(), FactoryV2, { kind: "uups" }),
      ).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
    });
  });

  // ─── Admin functions ──────────────────────────────────────────────

  describe("Admin functions", function () {
    it("admin can update fee params", async function () {
      await escrow.connect(admin).setFeeParams(200, 10, 5);
      expect(await escrow.baseRate()).to.equal(200);
      expect(await escrow.holdingRate()).to.equal(10);
      expect(await escrow.minEscrowFee()).to.equal(5);
    });

    it("non-admin cannot update fee params", async function () {
      await expect(
        escrow.connect(outsider).setFeeParams(200, 10, 5),
      ).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
    });

    it("admin can update treasury", async function () {
      await escrow.connect(admin).setTreasury(outsider.address);
      expect(await escrow.treasury()).to.equal(outsider.address);
    });

    it("cannot set treasury to zero address", async function () {
      await expect(
        escrow.connect(admin).setTreasury(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(escrow, "InvalidAddress");
    });
  });

  // ─── Release from Disputed state ─────────────────────────────────

  describe("Release/Refund from Disputed state", function () {
    beforeEach(async function () {
      await createDefaultEscrow();
      await escrow.connect(depositor).dispute(ESCROW_ID);
    });

    it("depositor can release a disputed escrow", async function () {
      await escrow.connect(depositor).release(ESCROW_ID);
      const e = await escrow.getEscrow(ESCROW_ID);
      expect(e.status).to.equal(1); // Released
    });

    it("arbiter can release a disputed escrow", async function () {
      await escrow.connect(arbiter).release(ESCROW_ID);
      const e = await escrow.getEscrow(ESCROW_ID);
      expect(e.status).to.equal(1); // Released
    });

    it("arbiter can refund a disputed escrow", async function () {
      await escrow.connect(arbiter).refund(ESCROW_ID);
      const e = await escrow.getEscrow(ESCROW_ID);
      expect(e.status).to.equal(2); // Refunded
    });

    it("beneficiary can refund a disputed escrow", async function () {
      await escrow.connect(beneficiary).refund(ESCROW_ID);
      const e = await escrow.getEscrow(ESCROW_ID);
      expect(e.status).to.equal(2); // Refunded
    });
  });

  // ─── Edge: Escrow not found ───────────────────────────────────────

  describe("Non-existent escrow", function () {
    it("release reverts for unknown escrowId", async function () {
      const fakeId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      await expect(
        escrow.connect(depositor).release(fakeId),
      ).to.be.revertedWithCustomError(escrow, "EscrowNotFound");
    });

    it("refund reverts for unknown escrowId", async function () {
      const fakeId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      await expect(
        escrow.connect(beneficiary).refund(fakeId),
      ).to.be.revertedWithCustomError(escrow, "EscrowNotFound");
    });

    it("fund reverts for unknown escrowId", async function () {
      const fakeId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      await token.connect(depositor).approve(await escrow.getAddress(), 100);
      await expect(
        escrow.connect(depositor).fund(fakeId, 100),
      ).to.be.revertedWithCustomError(escrow, "EscrowNotFound");
    });
  });
});
