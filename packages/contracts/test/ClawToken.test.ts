import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { ClawToken } from "../typechain-types";

describe("ClawToken", function () {
  let token: ClawToken;
  let admin: HardhatEthersSigner;
  let minter: HardhatEthersSigner;
  let burner: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const BURNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
  const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  beforeEach(async function () {
    [admin, minter, burner, pauser, user1, user2] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("ClawToken");
    const proxy = await upgrades.deployProxy(
      Factory,
      ["ClawNet Token", "TOKEN", admin.address],
      { kind: "uups", initializer: "initialize" },
    );
    await proxy.waitForDeployment();
    token = proxy as unknown as ClawToken;

    // Grant specific roles
    await token.connect(admin).grantRole(MINTER_ROLE, minter.address);
    await token.connect(admin).grantRole(BURNER_ROLE, burner.address);
    await token.connect(admin).grantRole(PAUSER_ROLE, pauser.address);
  });

  // ─── Initialization ────────────────────────────────────────────────

  describe("Initialization", function () {
    it("should set correct name and symbol", async function () {
      expect(await token.name()).to.equal("ClawNet Token");
      expect(await token.symbol()).to.equal("TOKEN");
    });

    it("should return decimals = 0", async function () {
      expect(await token.decimals()).to.equal(0);
    });

    it("should grant DEFAULT_ADMIN_ROLE to admin", async function () {
      expect(await token.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("should grant MINTER_ROLE to admin at init", async function () {
      expect(await token.hasRole(MINTER_ROLE, admin.address)).to.be.true;
    });

    it("should not allow re-initialization", async function () {
      await expect(
        token.initialize("Hack", "H", user1.address),
      ).to.be.revertedWithCustomError(token, "InvalidInitialization");
    });
  });

  // ─── Minting ───────────────────────────────────────────────────────

  describe("Minting", function () {
    it("MINTER_ROLE can mint tokens", async function () {
      await token.connect(minter).mint(user1.address, 100);
      expect(await token.balanceOf(user1.address)).to.equal(100);
    });

    it("admin (who also has MINTER_ROLE) can mint", async function () {
      await token.connect(admin).mint(user1.address, 50);
      expect(await token.balanceOf(user1.address)).to.equal(50);
    });

    it("non-MINTER_ROLE cannot mint", async function () {
      await expect(
        token.connect(user1).mint(user1.address, 100),
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });

    it("mint emits Transfer event from zero address", async function () {
      await expect(token.connect(minter).mint(user1.address, 42))
        .to.emit(token, "Transfer")
        .withArgs(ethers.ZeroAddress, user1.address, 42);
    });
  });

  // ─── Burning ───────────────────────────────────────────────────────

  describe("Burning", function () {
    beforeEach(async function () {
      await token.connect(minter).mint(user1.address, 200);
    });

    it("BURNER_ROLE can burn tokens from an address", async function () {
      await token.connect(burner).burn(user1.address, 50);
      expect(await token.balanceOf(user1.address)).to.equal(150);
    });

    it("non-BURNER_ROLE cannot burn", async function () {
      await expect(
        token.connect(user1).burn(user1.address, 50),
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });

    it("burn more than balance reverts", async function () {
      await expect(
        token.connect(burner).burn(user1.address, 999),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });
  });

  // ─── Transfer ──────────────────────────────────────────────────────

  describe("Transfer", function () {
    beforeEach(async function () {
      await token.connect(minter).mint(user1.address, 500);
    });

    it("user can transfer tokens", async function () {
      await token.connect(user1).transfer(user2.address, 100);
      expect(await token.balanceOf(user1.address)).to.equal(400);
      expect(await token.balanceOf(user2.address)).to.equal(100);
    });

    it("transfer more than balance reverts", async function () {
      await expect(
        token.connect(user1).transfer(user2.address, 999),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("transfer emits Transfer event", async function () {
      await expect(token.connect(user1).transfer(user2.address, 10))
        .to.emit(token, "Transfer")
        .withArgs(user1.address, user2.address, 10);
    });
  });

  // ─── Approve + TransferFrom ────────────────────────────────────────

  describe("Approve + TransferFrom", function () {
    beforeEach(async function () {
      await token.connect(minter).mint(user1.address, 500);
    });

    it("approve + transferFrom works", async function () {
      await token.connect(user1).approve(user2.address, 200);
      await token.connect(user2).transferFrom(user1.address, user2.address, 200);
      expect(await token.balanceOf(user1.address)).to.equal(300);
      expect(await token.balanceOf(user2.address)).to.equal(200);
    });

    it("transferFrom without approval reverts", async function () {
      await expect(
        token.connect(user2).transferFrom(user1.address, user2.address, 100),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("transferFrom exceeding allowance reverts", async function () {
      await token.connect(user1).approve(user2.address, 50);
      await expect(
        token.connect(user2).transferFrom(user1.address, user2.address, 100),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });
  });

  // ─── Pause / Unpause ──────────────────────────────────────────────

  describe("Pause / Unpause", function () {
    beforeEach(async function () {
      await token.connect(minter).mint(user1.address, 500);
    });

    it("PAUSER_ROLE can pause", async function () {
      await token.connect(pauser).pause();
      expect(await token.paused()).to.be.true;
    });

    it("pause blocks transfer", async function () {
      await token.connect(pauser).pause();
      await expect(
        token.connect(user1).transfer(user2.address, 10),
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it("pause blocks mint", async function () {
      await token.connect(pauser).pause();
      await expect(
        token.connect(minter).mint(user1.address, 10),
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it("pause blocks burn", async function () {
      await token.connect(pauser).pause();
      await expect(
        token.connect(burner).burn(user1.address, 10),
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it("unpause re-enables transfers", async function () {
      await token.connect(pauser).pause();
      await token.connect(pauser).unpause();
      await token.connect(user1).transfer(user2.address, 10);
      expect(await token.balanceOf(user2.address)).to.equal(10);
    });

    it("non-PAUSER_ROLE cannot pause", async function () {
      await expect(
        token.connect(user1).pause(),
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });
  });

  // ─── Upgrade ───────────────────────────────────────────────────────

  describe("Upgrade (UUPS)", function () {
    it("admin can upgrade implementation", async function () {
      await token.connect(minter).mint(user1.address, 1000);

      // Deploy V2 (same contract, simulating upgrade)
      const FactoryV2 = await ethers.getContractFactory("ClawToken");
      const upgraded = await upgrades.upgradeProxy(
        await token.getAddress(),
        FactoryV2,
        { kind: "uups" },
      );

      // State preserved
      expect(await (upgraded as unknown as ClawToken).balanceOf(user1.address)).to.equal(1000);
      expect(await (upgraded as unknown as ClawToken).name()).to.equal("ClawNet Token");
    });

    it("non-admin cannot upgrade", async function () {
      const FactoryV2 = await ethers.getContractFactory("ClawToken", user1);
      await expect(
        upgrades.upgradeProxy(await token.getAddress(), FactoryV2, { kind: "uups" }),
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });
  });

  // ─── Total Supply ─────────────────────────────────────────────────

  describe("Total Supply", function () {
    it("totalSupply reflects mints and burns", async function () {
      expect(await token.totalSupply()).to.equal(0);

      await token.connect(minter).mint(user1.address, 1000);
      expect(await token.totalSupply()).to.equal(1000);

      await token.connect(burner).burn(user1.address, 300);
      expect(await token.totalSupply()).to.equal(700);
    });
  });
});
