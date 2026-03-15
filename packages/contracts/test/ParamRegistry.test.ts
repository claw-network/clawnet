import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { ParamRegistry } from "../typechain-types";

describe("ParamRegistry", function () {
  let registry: ParamRegistry;
  let admin: HardhatEthersSigner;
  let governor: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;

  const GOVERNOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GOVERNOR_ROLE"));

  // Use the same key constants as the contract
  const ESCROW_BASE_RATE = ethers.keccak256(ethers.toUtf8Bytes("ESCROW_BASE_RATE"));
  const ESCROW_HOLDING_RATE = ethers.keccak256(ethers.toUtf8Bytes("ESCROW_HOLDING_RATE"));
  const ESCROW_MIN_FEE = ethers.keccak256(ethers.toUtf8Bytes("ESCROW_MIN_FEE"));
  const MIN_NODE_STAKE = ethers.keccak256(ethers.toUtf8Bytes("MIN_NODE_STAKE"));
  const UNSTAKE_COOLDOWN = ethers.keccak256(ethers.toUtf8Bytes("UNSTAKE_COOLDOWN"));
  const PROPOSAL_THRESHOLD = ethers.keccak256(ethers.toUtf8Bytes("PROPOSAL_THRESHOLD"));
  const VOTING_PERIOD = ethers.keccak256(ethers.toUtf8Bytes("VOTING_PERIOD"));
  const TIMELOCK_DELAY = ethers.keccak256(ethers.toUtf8Bytes("TIMELOCK_DELAY"));
  const QUORUM_BPS = ethers.keccak256(ethers.toUtf8Bytes("QUORUM_BPS"));
  const CUSTOM_KEY = ethers.keccak256(ethers.toUtf8Bytes("CUSTOM_TEST_KEY"));

  async function deployFixture() {
    [admin, governor, outsider] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("ParamRegistry");
    registry = (await upgrades.deployProxy(Factory, [admin.address], {
      kind: "uups",
    })) as unknown as ParamRegistry;
    await registry.waitForDeployment();

    // Grant GOVERNOR_ROLE to a separate signer for clarity
    await registry.grantRole(GOVERNOR_ROLE, governor.address);
  }

  beforeEach(async function () {
    await deployFixture();
  });

  // ─── Initialization ────────────────────────────────────────────

  describe("initialization", function () {
    it("should grant DEFAULT_ADMIN_ROLE to admin", async function () {
      expect(
        await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address)
      ).to.equal(true);
    });

    it("should grant GOVERNOR_ROLE to admin on initialize", async function () {
      expect(await registry.hasRole(GOVERNOR_ROLE, admin.address)).to.equal(true);
    });

    it("should revert if admin is zero address", async function () {
      const Factory = await ethers.getContractFactory("ParamRegistry");
      await expect(
        upgrades.deployProxy(Factory, [ethers.ZeroAddress], { kind: "uups" })
      ).to.be.revertedWithCustomError(registry, "InvalidAddress");
    });

    it("should not be re-initializable", async function () {
      await expect(registry.initialize(outsider.address)).to.be.reverted;
    });
  });

  // ─── setParam ──────────────────────────────────────────────────

  describe("setParam", function () {
    it("should set and read a parameter", async function () {
      await registry.connect(governor).setParam(ESCROW_BASE_RATE, 50);
      expect(await registry.getParam(ESCROW_BASE_RATE)).to.equal(50);
    });

    it("should emit ParamSet event with old and new values", async function () {
      await expect(registry.connect(governor).setParam(MIN_NODE_STAKE, 10000))
        .to.emit(registry, "ParamSet")
        .withArgs(MIN_NODE_STAKE, 0, 10000);
    });

    it("should emit correct old value on update", async function () {
      await registry.connect(governor).setParam(MIN_NODE_STAKE, 10000);
      await expect(registry.connect(governor).setParam(MIN_NODE_STAKE, 20000))
        .to.emit(registry, "ParamSet")
        .withArgs(MIN_NODE_STAKE, 10000, 20000);
    });

    it("should allow setting value to 0", async function () {
      await registry.connect(governor).setParam(ESCROW_MIN_FEE, 100);
      await registry.connect(governor).setParam(ESCROW_MIN_FEE, 0);
      expect(await registry.getParam(ESCROW_MIN_FEE)).to.equal(0);
    });

    it("should revert if caller lacks GOVERNOR_ROLE", async function () {
      await expect(
        registry.connect(outsider).setParam(ESCROW_BASE_RATE, 50)
      ).to.be.reverted;
    });

    it("should track new keys in key list", async function () {
      await registry.connect(governor).setParam(ESCROW_BASE_RATE, 50);
      await registry.connect(governor).setParam(MIN_NODE_STAKE, 10000);
      expect(await registry.keyCount()).to.equal(2);
    });

    it("should not duplicate key on re-set", async function () {
      await registry.connect(governor).setParam(ESCROW_BASE_RATE, 50);
      await registry.connect(governor).setParam(ESCROW_BASE_RATE, 100);
      expect(await registry.keyCount()).to.equal(1);
    });
  });

  // ─── setBatchParams ────────────────────────────────────────────

  describe("setBatchParams", function () {
    it("should set multiple params in one transaction", async function () {
      const keys = [ESCROW_BASE_RATE, ESCROW_HOLDING_RATE, ESCROW_MIN_FEE];
      const values = [50, 10, 1];

      await registry.connect(governor).setBatchParams(keys, values);

      expect(await registry.getParam(ESCROW_BASE_RATE)).to.equal(50);
      expect(await registry.getParam(ESCROW_HOLDING_RATE)).to.equal(10);
      expect(await registry.getParam(ESCROW_MIN_FEE)).to.equal(1);
    });

    it("should emit ParamSet for each key and ParamBatchSet", async function () {
      const keys = [MIN_NODE_STAKE, UNSTAKE_COOLDOWN];
      const values = [10000, 604800];

      const tx = await registry.connect(governor).setBatchParams(keys, values);

      await expect(tx).to.emit(registry, "ParamSet").withArgs(MIN_NODE_STAKE, 0, 10000);
      await expect(tx).to.emit(registry, "ParamSet").withArgs(UNSTAKE_COOLDOWN, 0, 604800);
      await expect(tx).to.emit(registry, "ParamBatchSet");
    });

    it("should revert on empty batch", async function () {
      await expect(
        registry.connect(governor).setBatchParams([], [])
      ).to.be.revertedWithCustomError(registry, "EmptyBatch");
    });

    it("should revert on length mismatch", async function () {
      await expect(
        registry.connect(governor).setBatchParams(
          [ESCROW_BASE_RATE, ESCROW_MIN_FEE],
          [50]
        )
      ).to.be.revertedWithCustomError(registry, "ArrayLengthMismatch");
    });

    it("should revert if caller lacks GOVERNOR_ROLE", async function () {
      await expect(
        registry.connect(outsider).setBatchParams([MIN_NODE_STAKE], [10000])
      ).to.be.reverted;
    });

    it("should not duplicate keys when batch-setting same key", async function () {
      await registry.connect(governor).setBatchParams(
        [ESCROW_BASE_RATE, ESCROW_BASE_RATE],
        [50, 100]
      );
      expect(await registry.keyCount()).to.equal(1);
      expect(await registry.getParam(ESCROW_BASE_RATE)).to.equal(100);
    });
  });

  // ─── getParam ──────────────────────────────────────────────────

  describe("getParam", function () {
    it("should return 0 for unset key", async function () {
      expect(await registry.getParam(CUSTOM_KEY)).to.equal(0);
    });

    it("should return correct value after set", async function () {
      await registry.connect(governor).setParam(VOTING_PERIOD, 7200);
      expect(await registry.getParam(VOTING_PERIOD)).to.equal(7200);
    });
  });

  // ─── getParamWithDefault ───────────────────────────────────────

  describe("getParamWithDefault", function () {
    it("should return default for unset key", async function () {
      expect(await registry.getParamWithDefault(CUSTOM_KEY, 999)).to.equal(999);
    });

    it("should return stored value when set", async function () {
      await registry.connect(governor).setParam(TIMELOCK_DELAY, 86400);
      expect(await registry.getParamWithDefault(TIMELOCK_DELAY, 999)).to.equal(86400);
    });

    it("should return default when value is explicitly set to 0", async function () {
      await registry.connect(governor).setParam(CUSTOM_KEY, 42);
      await registry.connect(governor).setParam(CUSTOM_KEY, 0);
      // Value is 0 → default returned (by design: 0 means "unset")
      expect(await registry.getParamWithDefault(CUSTOM_KEY, 999)).to.equal(999);
    });
  });

  // ─── View helpers ──────────────────────────────────────────────

  describe("view helpers", function () {
    it("keyCount should be 0 initially", async function () {
      expect(await registry.keyCount()).to.equal(0);
    });

    it("getAllParams should return empty arrays initially", async function () {
      const [keys, values] = await registry.getAllParams();
      expect(keys.length).to.equal(0);
      expect(values.length).to.equal(0);
    });

    it("getAllParams should return all set params", async function () {
      await registry.connect(governor).setParam(ESCROW_BASE_RATE, 50);
      await registry.connect(governor).setParam(MIN_NODE_STAKE, 10000);
      await registry.connect(governor).setParam(QUORUM_BPS, 2000);

      const [keys, values] = await registry.getAllParams();
      expect(keys.length).to.equal(3);
      expect(values.length).to.equal(3);

      // Verify key-value pairs
      const map = new Map<string, bigint>();
      for (let i = 0; i < keys.length; i++) {
        map.set(keys[i], values[i]);
      }
      expect(map.get(ESCROW_BASE_RATE)).to.equal(50n);
      expect(map.get(MIN_NODE_STAKE)).to.equal(10000n);
      expect(map.get(QUORUM_BPS)).to.equal(2000n);
    });
  });

  // ─── Parameter key constants ───────────────────────────────────

  describe("parameter key constants", function () {
    it("should expose all 20 key constants", async function () {
      // Just verify they are accessible and non-zero
      const keys = [
        await registry.MARKET_FEE_INFO(),
        await registry.MARKET_FEE_TASK(),
        await registry.MARKET_FEE_CAP(),
        await registry.MARKET_MIN_FEE(),
        await registry.MARKET_MAX_FEE(),
        await registry.ESCROW_BASE_RATE(),
        await registry.ESCROW_HOLDING_RATE(),
        await registry.ESCROW_MIN_FEE(),
        await registry.MIN_TRANSFER_AMOUNT(),
        await registry.MIN_ESCROW_AMOUNT(),
        await registry.MIN_NODE_STAKE(),
        await registry.UNSTAKE_COOLDOWN(),
        await registry.VALIDATOR_REWARD_RATE(),
        await registry.SLASH_PER_VIOLATION(),
        await registry.TRUST_DECAY_RATE(),
        await registry.EPOCH_DURATION(),
        await registry.PROPOSAL_THRESHOLD(),
        await registry.VOTING_PERIOD(),
        await registry.TIMELOCK_DELAY(),
        await registry.QUORUM_BPS(),
      ];

      // All keys should be unique non-zero hashes
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).to.equal(20);
      for (const key of keys) {
        expect(key).to.not.equal(ethers.ZeroHash);
      }
    });

    it("key constants should match keccak256 of string names", async function () {
      expect(await registry.ESCROW_BASE_RATE()).to.equal(
        ethers.keccak256(ethers.toUtf8Bytes("ESCROW_BASE_RATE"))
      );
      expect(await registry.MIN_NODE_STAKE()).to.equal(
        ethers.keccak256(ethers.toUtf8Bytes("MIN_NODE_STAKE"))
      );
      expect(await registry.QUORUM_BPS()).to.equal(
        ethers.keccak256(ethers.toUtf8Bytes("QUORUM_BPS"))
      );
    });
  });

  // ─── Access control ────────────────────────────────────────────

  describe("access control", function () {
    it("admin can grant GOVERNOR_ROLE", async function () {
      await registry.grantRole(GOVERNOR_ROLE, outsider.address);
      await registry.connect(outsider).setParam(CUSTOM_KEY, 42);
      expect(await registry.getParam(CUSTOM_KEY)).to.equal(42);
    });

    it("admin can revoke GOVERNOR_ROLE", async function () {
      await registry.revokeRole(GOVERNOR_ROLE, governor.address);
      await expect(
        registry.connect(governor).setParam(CUSTOM_KEY, 42)
      ).to.be.reverted;
    });

    it("governor cannot grant roles", async function () {
      await expect(
        registry.connect(governor).grantRole(GOVERNOR_ROLE, outsider.address)
      ).to.be.reverted;
    });
  });

  // ─── Upgrade ───────────────────────────────────────────────────

  describe("upgrade", function () {
    it("should preserve state after upgrade", async function () {
      // Set some params
      await registry.connect(governor).setParam(ESCROW_BASE_RATE, 50);
      await registry.connect(governor).setParam(MIN_NODE_STAKE, 10000);

      // Upgrade to same implementation (simulates upgrade)
      const Factory = await ethers.getContractFactory("ParamRegistry");
      const upgraded = (await upgrades.upgradeProxy(
        await registry.getAddress(),
        Factory
      )) as unknown as ParamRegistry;

      // Verify state preserved
      expect(await upgraded.getParam(ESCROW_BASE_RATE)).to.equal(50);
      expect(await upgraded.getParam(MIN_NODE_STAKE)).to.equal(10000);
      expect(await upgraded.keyCount()).to.equal(2);
    });

    it("should revert upgrade from non-admin", async function () {
      const Factory = await ethers.getContractFactory("ParamRegistry", outsider);
      await expect(
        upgrades.upgradeProxy(await registry.getAddress(), Factory)
      ).to.be.reverted;
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────

  describe("edge cases", function () {
    it("should handle max uint256 value", async function () {
      const maxVal = ethers.MaxUint256;
      await registry.connect(governor).setParam(CUSTOM_KEY, maxVal);
      expect(await registry.getParam(CUSTOM_KEY)).to.equal(maxVal);
    });

    it("should handle setting same key to same value", async function () {
      await registry.connect(governor).setParam(CUSTOM_KEY, 42);
      await expect(registry.connect(governor).setParam(CUSTOM_KEY, 42))
        .to.emit(registry, "ParamSet")
        .withArgs(CUSTOM_KEY, 42, 42);
    });

    it("should handle arbitrary bytes32 keys", async function () {
      const arbitraryKey = ethers.encodeBytes32String("MY_CUSTOM_PARAM");
      await registry.connect(governor).setParam(arbitraryKey, 777);
      expect(await registry.getParam(arbitraryKey)).to.equal(777);
    });
  });
});
