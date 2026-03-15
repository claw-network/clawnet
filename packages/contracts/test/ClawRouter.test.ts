import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { ClawRouter } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { keccak256, toUtf8Bytes, ZeroHash, ZeroAddress, AbiCoder, getAddress } from "ethers";

// ── Helpers ───────────────────────────────────────────────────────────

async function deployRouter(): Promise<{
  router: ClawRouter;
  admin: HardhatEthersSigner;
  registrar: HardhatEthersSigner;
  user: HardhatEthersSigner;
}> {
  const [admin, registrar, user] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("ClawRouter");
  const router = (await upgrades.deployProxy(factory, [admin.address], {
    kind: "uups",
  })) as unknown as ClawRouter;
  await router.waitForDeployment();

  const REGISTRAR_ROLE = await router.REGISTRAR_ROLE();
  await router.connect(admin).grantRole(REGISTRAR_ROLE, registrar.address);

  return { router, admin, registrar, user };
}

// Dummy addresses for testing (normalised to EIP-55 checksum)
const ADDR_A = getAddress("0x000000000000000000000000000000000000000a");
const ADDR_B = getAddress("0x000000000000000000000000000000000000000b");
const ADDR_C = getAddress("0x000000000000000000000000000000000000000c");
const CUSTOM_KEY = keccak256(toUtf8Bytes("CUSTOM_MODULE"));

// ── Tests ─────────────────────────────────────────────────────────────

describe("ClawRouter", () => {
  // ──────────────────────────────────────────────────────────────────
  // 1. Initialization
  // ──────────────────────────────────────────────────────────────────
  describe("Initialization", () => {
    it("admin has DEFAULT_ADMIN and REGISTRAR_ROLE", async () => {
      const { router, admin } = await deployRouter();
      expect(await router.hasRole(await router.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      expect(await router.hasRole(await router.REGISTRAR_ROLE(), admin.address)).to.be.true;
    });

    it("moduleCount starts at 0", async () => {
      const { router } = await deployRouter();
      expect(await router.moduleCount()).to.equal(0);
    });

    it("cannot initialize twice", async () => {
      const { router, admin } = await deployRouter();
      await expect(router.initialize(admin.address)).to.be.reverted;
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 2. registerModule
  // ──────────────────────────────────────────────────────────────────
  describe("registerModule", () => {
    it("registers a module and emits ModuleRegistered", async () => {
      const { router, registrar } = await deployRouter();
      const key = await router.MODULE_TOKEN();
      const tx = router.connect(registrar).registerModule(key, ADDR_A);
      await expect(tx).to.emit(router, "ModuleRegistered").withArgs(key, ADDR_A);

      expect(await router.modules(key)).to.equal(ADDR_A);
      expect(await router.moduleCount()).to.equal(1);
    });

    it("updates a module and emits ModuleUpdated", async () => {
      const { router, registrar } = await deployRouter();
      const key = await router.MODULE_TOKEN();
      await router.connect(registrar).registerModule(key, ADDR_A);

      const tx = router.connect(registrar).registerModule(key, ADDR_B);
      await expect(tx).to.emit(router, "ModuleUpdated").withArgs(key, ADDR_A, ADDR_B);

      expect(await router.modules(key)).to.equal(ADDR_B);
      // moduleCount should NOT increase on update
      expect(await router.moduleCount()).to.equal(1);
    });

    it("registers all 8 well-known module keys", async () => {
      const { router, registrar } = await deployRouter();
      const keys = [
        await router.MODULE_TOKEN(),
        await router.MODULE_ESCROW(),
        await router.MODULE_IDENTITY(),
        await router.MODULE_STAKING(),
        await router.MODULE_DAO(),
        await router.MODULE_CONTRACTS(),
        await router.MODULE_REPUTATION(),
        await router.MODULE_PARAM_REGISTRY(),
      ];
      for (let i = 0; i < keys.length; i++) {
        const addr = ethers.getAddress("0x" + (i + 1).toString(16).padStart(40, "0"));
        await router.connect(registrar).registerModule(keys[i], addr);
      }
      expect(await router.moduleCount()).to.equal(8);
    });

    it("reverts on zero key", async () => {
      const { router, registrar } = await deployRouter();
      await expect(
        router.connect(registrar).registerModule(ZeroHash, ADDR_A)
      ).to.be.revertedWithCustomError(router, "ZeroKey");
    });

    it("reverts on zero address", async () => {
      const { router, registrar } = await deployRouter();
      const key = await router.MODULE_TOKEN();
      await expect(
        router.connect(registrar).registerModule(key, ZeroAddress)
      ).to.be.revertedWithCustomError(router, "ZeroAddress");
    });

    it("reverts if caller lacks REGISTRAR_ROLE", async () => {
      const { router, user } = await deployRouter();
      const key = await router.MODULE_TOKEN();
      await expect(
        router.connect(user).registerModule(key, ADDR_A)
      ).to.be.reverted;
    });

    it("supports custom module keys", async () => {
      const { router, registrar } = await deployRouter();
      await router.connect(registrar).registerModule(CUSTOM_KEY, ADDR_C);
      expect(await router.modules(CUSTOM_KEY)).to.equal(ADDR_C);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 3. batchRegisterModules
  // ──────────────────────────────────────────────────────────────────
  describe("batchRegisterModules", () => {
    it("registers multiple modules in one tx", async () => {
      const { router, registrar } = await deployRouter();
      const keys = [await router.MODULE_TOKEN(), await router.MODULE_ESCROW()];
      const addrs = [ADDR_A, ADDR_B];
      const tx = router.connect(registrar).batchRegisterModules(keys, addrs);
      await expect(tx).to.emit(router, "ModuleRegistered").withArgs(keys[0], ADDR_A);
      await expect(tx).to.emit(router, "ModuleRegistered").withArgs(keys[1], ADDR_B);

      expect(await router.moduleCount()).to.equal(2);
    });

    it("reverts on empty batch", async () => {
      const { router, registrar } = await deployRouter();
      await expect(
        router.connect(registrar).batchRegisterModules([], [])
      ).to.be.revertedWithCustomError(router, "EmptyBatch");
    });

    it("reverts on mismatched lengths", async () => {
      const { router, registrar } = await deployRouter();
      await expect(
        router.connect(registrar).batchRegisterModules(
          [await router.MODULE_TOKEN()],
          [ADDR_A, ADDR_B]
        )
      ).to.be.revertedWithCustomError(router, "ArrayLengthMismatch");
    });

    it("reverts if any key is zero", async () => {
      const { router, registrar } = await deployRouter();
      await expect(
        router.connect(registrar).batchRegisterModules(
          [await router.MODULE_TOKEN(), ZeroHash],
          [ADDR_A, ADDR_B]
        )
      ).to.be.revertedWithCustomError(router, "ZeroKey");
    });

    it("reverts if any address is zero", async () => {
      const { router, registrar } = await deployRouter();
      await expect(
        router.connect(registrar).batchRegisterModules(
          [await router.MODULE_TOKEN(), await router.MODULE_ESCROW()],
          [ADDR_A, ZeroAddress]
        )
      ).to.be.revertedWithCustomError(router, "ZeroAddress");
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 4. getModule / getModuleOrZero
  // ──────────────────────────────────────────────────────────────────
  describe("getModule / getModuleOrZero", () => {
    it("getModule returns address for registered module", async () => {
      const { router, registrar } = await deployRouter();
      const key = await router.MODULE_TOKEN();
      await router.connect(registrar).registerModule(key, ADDR_A);
      expect(await router.getModule(key)).to.equal(ADDR_A);
    });

    it("getModule reverts for unregistered module", async () => {
      const { router } = await deployRouter();
      const key = await router.MODULE_TOKEN();
      await expect(router.getModule(key)).to.be.revertedWithCustomError(router, "ModuleNotFound");
    });

    it("getModuleOrZero returns zero for unregistered module", async () => {
      const { router } = await deployRouter();
      const key = await router.MODULE_TOKEN();
      expect(await router.getModuleOrZero(key)).to.equal(ZeroAddress);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 5. getAllModules
  // ──────────────────────────────────────────────────────────────────
  describe("getAllModules", () => {
    it("returns all registered modules", async () => {
      const { router, registrar } = await deployRouter();
      const k1 = await router.MODULE_TOKEN();
      const k2 = await router.MODULE_ESCROW();
      await router.connect(registrar).registerModule(k1, ADDR_A);
      await router.connect(registrar).registerModule(k2, ADDR_B);

      const [keys, addrs] = await router.getAllModules();
      expect(keys.length).to.equal(2);
      expect(keys[0]).to.equal(k1);
      expect(keys[1]).to.equal(k2);
      expect(addrs[0]).to.equal(ADDR_A);
      expect(addrs[1]).to.equal(ADDR_B);
    });

    it("returns empty arrays when no modules registered", async () => {
      const { router } = await deployRouter();
      const [keys, addrs] = await router.getAllModules();
      expect(keys.length).to.equal(0);
      expect(addrs.length).to.equal(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 6. Multicall
  // ──────────────────────────────────────────────────────────────────
  describe("multicall / staticMulticall", () => {
    it("staticMulticall batches read calls", async () => {
      const { router, registrar, admin } = await deployRouter();

      // Deploy a real token to call against
      const TokenFactory = await ethers.getContractFactory("ClawToken");
      const token = await upgrades.deployProxy(
        TokenFactory,
        ["ClawNet Token", "TOKEN", admin.address],
        { kind: "uups" }
      );
      await token.waitForDeployment();
      const tokenAddr = await token.getAddress();

      // Batch: name() + symbol() + decimals()
      const iface = token.interface;
      const targets = [tokenAddr, tokenAddr, tokenAddr];
      const data = [
        iface.encodeFunctionData("name"),
        iface.encodeFunctionData("symbol"),
        iface.encodeFunctionData("decimals"),
      ];

      const results = await router.staticMulticall(targets, data);
      const coder = AbiCoder.defaultAbiCoder();
      expect(coder.decode(["string"], results[0])[0]).to.equal("ClawNet Token");
      expect(coder.decode(["string"], results[1])[0]).to.equal("TOKEN");
      expect(coder.decode(["uint8"], results[2])[0]).to.equal(0);
    });

    it("multicall reverts on empty batch", async () => {
      const { router } = await deployRouter();
      await expect(router.multicall([], [])).to.be.revertedWithCustomError(router, "EmptyBatch");
    });

    it("staticMulticall reverts on length mismatch", async () => {
      const { router } = await deployRouter();
      await expect(
        router.staticMulticall([ADDR_A], [])
      ).to.be.revertedWithCustomError(router, "ArrayLengthMismatch");
    });

    it("multicall reverts on failed sub-call", async () => {
      const { router } = await deployRouter();
      // Call a non-contract address with data -> will fail
      await expect(
        router.multicall(
          [ADDR_A],
          [ethers.toUtf8Bytes("0xdeadbeef")]  // nonsense call
        )
      ).to.be.revertedWithCustomError(router, "MulticallFailed");
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 7. UUPS Upgrade
  // ──────────────────────────────────────────────────────────────────
  describe("UUPS upgrade", () => {
    it("admin can upgrade", async () => {
      const { router, admin } = await deployRouter();
      const factory = await ethers.getContractFactory("ClawRouter", admin);
      const upgraded = await upgrades.upgradeProxy(await router.getAddress(), factory);
      expect(await upgraded.getAddress()).to.equal(await router.getAddress());
    });

    it("non-admin cannot upgrade", async () => {
      const { router, user } = await deployRouter();
      const factory = await ethers.getContractFactory("ClawRouter", user);
      await expect(
        upgrades.upgradeProxy(await router.getAddress(), factory)
      ).to.be.reverted;
    });

    it("state preserved after upgrade", async () => {
      const { router, admin, registrar } = await deployRouter();
      const key = await router.MODULE_TOKEN();
      await router.connect(registrar).registerModule(key, ADDR_A);

      const factory = await ethers.getContractFactory("ClawRouter", admin);
      const upgraded = (await upgrades.upgradeProxy(
        await router.getAddress(), factory
      )) as unknown as ClawRouter;

      expect(await upgraded.getModule(key)).to.equal(ADDR_A);
      expect(await upgraded.moduleCount()).to.equal(1);
    });
  });
});
