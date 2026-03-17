import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { ClawToken, ClawContracts } from "../typechain-types";

/**
 * ClawContracts unit tests — covers T-2.10 acceptance criteria:
 *  1. Create contract (params, milestones, events)
 *  2. Milestone count and amounts sum = totalAmount
 *  3. Signing flow (single sign → both sign → Signed)
 *  4. Submit milestone (only provider)
 *  5. Approve milestone (client / arbiter) → funds released to provider
 *  6. All milestones approved → contract completed
 *  7. Dispute → arbitration → release / refund / resume
 *  8. Timeout termination
 *  9. Invalid state transitions revert
 * 10. UUPS upgrade preserves state
 */
describe("ClawContracts", function () {
  let token: ClawToken;
  let contracts: ClawContracts;
  let admin: HardhatEthersSigner;
  let client: HardhatEthersSigner;
  let provider: HardhatEthersSigner;
  let arbiter: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;
  let globalArbiter: HardhatEthersSigner;

  const PLATFORM_FEE_BPS = 100n; // 1%
  const TOTAL_SUPPLY = 100_000n;
  const CONTRACT_AMOUNT = 1000n;
  const MILESTONE_1 = 600n;
  const MILESTONE_2 = 400n;

  // ContractStatus enum
  const CS_DRAFT = 0;
  const CS_SIGNED = 1;
  const CS_ACTIVE = 2;
  const CS_COMPLETED = 3;
  const CS_DISPUTED = 4;
  const CS_TERMINATED = 5;
  const CS_CANCELLED = 6;

  // MilestoneStatus enum
  const MS_PENDING = 0;
  const MS_SUBMITTED = 1;
  const MS_APPROVED = 2;
  const MS_REJECTED = 3;

  // DisputeResolution enum
  const DR_FAVOR_PROVIDER = 0;
  const DR_FAVOR_CLIENT = 1;
  const DR_RESUME = 2;

  let contractId: string;
  let deadline: number;
  let msDeadline1: number;
  let msDeadline2: number;
  const termsHash = ethers.keccak256(ethers.toUtf8Bytes("service-terms-v1"));
  const deliverable1 = ethers.keccak256(ethers.toUtf8Bytes("deliverable-1"));
  const deliverable2 = ethers.keccak256(ethers.toUtf8Bytes("deliverable-2"));
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("evidence"));
  const reason = ethers.keccak256(ethers.toUtf8Bytes("reason"));

  beforeEach(async function () {
    [admin, client, provider, arbiter, treasury, outsider, globalArbiter] =
      await ethers.getSigners();

    // Deploy ClawToken
    const TokenFactory = await ethers.getContractFactory("ClawToken");
    token = (await upgrades.deployProxy(TokenFactory, [
      "ClawToken",
      "CLAW",
      admin.address,
    ])) as unknown as ClawToken;

    // Deploy ClawContracts
    const ContractsFactory = await ethers.getContractFactory("ClawContracts");
    contracts = (await upgrades.deployProxy(ContractsFactory, [
      await token.getAddress(),
      treasury.address,
      PLATFORM_FEE_BPS,
      admin.address,
    ])) as unknown as ClawContracts;

    // Grant global ARBITER_ROLE to globalArbiter
    const ARBITER_ROLE = await contracts.ARBITER_ROLE();
    await contracts.connect(admin).grantRole(ARBITER_ROLE, globalArbiter.address);

    // Mint tokens to client
    const MINTER_ROLE = await token.MINTER_ROLE();
    await token.connect(admin).grantRole(MINTER_ROLE, admin.address);
    await token.connect(admin).mint(client.address, TOTAL_SUPPLY);

    // Set up timing
    const now = await time.latest();
    deadline = now + 86400; // +1 day
    msDeadline1 = now + 43200; // +12 hours
    msDeadline2 = now + 86400; // +24 hours

    // Generate unique contract ID
    contractId = ethers.keccak256(
      ethers.solidityPacked(
        ["string", "uint256"],
        ["contract-", BigInt(now)]
      )
    );
  });

  // ─── Helper: create, sign, activate ────────────────────────────

  async function createDefaultContract(id?: string) {
    const cId = id || contractId;
    await contracts.connect(client).createContract(
      cId,
      provider.address,
      arbiter.address,
      CONTRACT_AMOUNT,
      termsHash,
      deadline,
      [MILESTONE_1, MILESTONE_2],
      [msDeadline1, msDeadline2]
    );
    return cId;
  }

  async function signBothParties(cId?: string) {
    const id = cId || contractId;
    await contracts.connect(client).signContract(id);
    await contracts.connect(provider).signContract(id);
  }

  async function activateDefault(cId?: string) {
    const id = cId || contractId;
    const fee = (CONTRACT_AMOUNT * PLATFORM_FEE_BPS) / 10000n;
    const totalApproval = CONTRACT_AMOUNT + fee;
    await token
      .connect(client)
      .approve(await contracts.getAddress(), totalApproval);
    await contracts.connect(client).activateContract(id);
  }

  async function fullSetup(cId?: string) {
    const id = cId || contractId;
    await createDefaultContract(id);
    await signBothParties(id);
    await activateDefault(id);
    return id;
  }

  // ═════════════════════════════════════════════════════════════════
  // 1. Contract Creation
  // ═════════════════════════════════════════════════════════════════
  describe("1. Contract Creation", function () {
    it("should create a contract in Draft status", async function () {
      await createDefaultContract();
      const c = await contracts.getContract(contractId);
      expect(c.client).to.equal(client.address);
      expect(c.provider).to.equal(provider.address);
      expect(c.arbiter).to.equal(arbiter.address);
      expect(c.totalAmount).to.equal(CONTRACT_AMOUNT);
      expect(c.milestoneCount).to.equal(2);
      expect(c.status).to.equal(CS_DRAFT);
      expect(c.clientSigned).to.be.false;
      expect(c.providerSigned).to.be.false;
      expect(c.fundedAmount).to.equal(0);
      expect(c.releasedAmount).to.equal(0);
      expect(c.termsHash).to.equal(termsHash);
    });

    it("should emit ContractCreated event with correct args", async function () {
      await expect(
        contracts.connect(client).createContract(
          contractId,
          provider.address,
          arbiter.address,
          CONTRACT_AMOUNT,
          termsHash,
          deadline,
          [MILESTONE_1, MILESTONE_2],
          [msDeadline1, msDeadline2]
        )
      )
        .to.emit(contracts, "ContractCreated")
        .withArgs(contractId, client.address, provider.address, CONTRACT_AMOUNT, 2);
    });

    it("should store milestones correctly", async function () {
      await createDefaultContract();
      const ms = await contracts.getMilestones(contractId);
      expect(ms.length).to.equal(2);
      expect(ms[0].amount).to.equal(MILESTONE_1);
      expect(ms[0].status).to.equal(MS_PENDING);
      expect(ms[1].amount).to.equal(MILESTONE_2);
      expect(ms[1].status).to.equal(MS_PENDING);
    });

    it("should revert if contractId already exists", async function () {
      await createDefaultContract();
      await expect(createDefaultContract()).to.be.revertedWithCustomError(
        contracts,
        "ContractAlreadyExists"
      );
    });

    it("should revert if provider is zero address", async function () {
      await expect(
        contracts.connect(client).createContract(
          contractId,
          ethers.ZeroAddress,
          arbiter.address,
          CONTRACT_AMOUNT,
          termsHash,
          deadline,
          [CONTRACT_AMOUNT],
          [msDeadline1]
        )
      ).to.be.revertedWithCustomError(contracts, "InvalidAddress");
    });

    it("should revert if provider == caller", async function () {
      await expect(
        contracts.connect(client).createContract(
          contractId,
          client.address,
          arbiter.address,
          CONTRACT_AMOUNT,
          termsHash,
          deadline,
          [CONTRACT_AMOUNT],
          [msDeadline1]
        )
      ).to.be.revertedWithCustomError(contracts, "InvalidAddress");
    });

    it("should revert if arbiter is zero address", async function () {
      await expect(
        contracts.connect(client).createContract(
          contractId,
          provider.address,
          ethers.ZeroAddress,
          CONTRACT_AMOUNT,
          termsHash,
          deadline,
          [CONTRACT_AMOUNT],
          [msDeadline1]
        )
      ).to.be.revertedWithCustomError(contracts, "InvalidAddress");
    });

    it("should revert if totalAmount is zero", async function () {
      await expect(
        contracts.connect(client).createContract(
          contractId,
          provider.address,
          arbiter.address,
          0,
          termsHash,
          deadline,
          [0n],
          [msDeadline1]
        )
      ).to.be.revertedWithCustomError(contracts, "InvalidAmount");
    });

    it("should revert if deadline is in the past", async function () {
      const pastDeadline = (await time.latest()) - 1;
      await expect(
        contracts.connect(client).createContract(
          contractId,
          provider.address,
          arbiter.address,
          CONTRACT_AMOUNT,
          termsHash,
          pastDeadline,
          [CONTRACT_AMOUNT],
          [pastDeadline]
        )
      ).to.be.revertedWithCustomError(contracts, "InvalidDeadline");
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 2. Milestone Validation
  // ═════════════════════════════════════════════════════════════════
  describe("2. Milestone Validation", function () {
    it("should revert if milestone amounts don't sum to totalAmount", async function () {
      await expect(
        contracts.connect(client).createContract(
          contractId,
          provider.address,
          arbiter.address,
          CONTRACT_AMOUNT,
          termsHash,
          deadline,
          [500n, 400n], // sum = 900 ≠ 1000
          [msDeadline1, msDeadline2]
        )
      ).to.be.revertedWithCustomError(contracts, "InvalidMilestones");
    });

    it("should revert if milestone array is empty", async function () {
      await expect(
        contracts.connect(client).createContract(
          contractId,
          provider.address,
          arbiter.address,
          CONTRACT_AMOUNT,
          termsHash,
          deadline,
          [],
          []
        )
      ).to.be.revertedWithCustomError(contracts, "InvalidMilestones");
    });

    it("should revert if milestone amount is zero", async function () {
      await expect(
        contracts.connect(client).createContract(
          contractId,
          provider.address,
          arbiter.address,
          CONTRACT_AMOUNT,
          termsHash,
          deadline,
          [0n, CONTRACT_AMOUNT],
          [msDeadline1, msDeadline2]
        )
      ).to.be.revertedWithCustomError(contracts, "InvalidAmount");
    });

    it("should revert if milestone deadline exceeds contract deadline", async function () {
      await expect(
        contracts.connect(client).createContract(
          contractId,
          provider.address,
          arbiter.address,
          CONTRACT_AMOUNT,
          termsHash,
          deadline,
          [CONTRACT_AMOUNT],
          [deadline + 1]
        )
      ).to.be.revertedWithCustomError(contracts, "InvalidDeadline");
    });

    it("should revert if milestone deadlines are not ascending", async function () {
      await expect(
        contracts.connect(client).createContract(
          contractId,
          provider.address,
          arbiter.address,
          CONTRACT_AMOUNT,
          termsHash,
          deadline,
          [MILESTONE_1, MILESTONE_2],
          [msDeadline2, msDeadline1] // reversed
        )
      ).to.be.revertedWithCustomError(contracts, "InvalidDeadline");
    });

    it("should revert if amounts and deadlines arrays differ in length", async function () {
      await expect(
        contracts.connect(client).createContract(
          contractId,
          provider.address,
          arbiter.address,
          CONTRACT_AMOUNT,
          termsHash,
          deadline,
          [MILESTONE_1, MILESTONE_2],
          [msDeadline1] // only 1 deadline for 2 milestones
        )
      ).to.be.revertedWithCustomError(contracts, "InvalidMilestones");
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 3. Signing Flow
  // ═════════════════════════════════════════════════════════════════
  describe("3. Signing Flow", function () {
    beforeEach(async function () {
      await createDefaultContract();
    });

    it("should allow client to sign first — stays Draft", async function () {
      await contracts.connect(client).signContract(contractId);
      const c = await contracts.getContract(contractId);
      expect(c.clientSigned).to.be.true;
      expect(c.providerSigned).to.be.false;
      expect(c.status).to.equal(CS_DRAFT);
    });

    it("should allow provider to sign first — stays Draft", async function () {
      await contracts.connect(provider).signContract(contractId);
      const c = await contracts.getContract(contractId);
      expect(c.clientSigned).to.be.false;
      expect(c.providerSigned).to.be.true;
      expect(c.status).to.equal(CS_DRAFT);
    });

    it("should transition to Signed when both sign", async function () {
      await signBothParties();
      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_SIGNED);
    });

    it("should emit ContractSigned for each signer", async function () {
      await expect(contracts.connect(client).signContract(contractId))
        .to.emit(contracts, "ContractSigned")
        .withArgs(contractId, client.address);
      await expect(contracts.connect(provider).signContract(contractId))
        .to.emit(contracts, "ContractSigned")
        .withArgs(contractId, provider.address);
    });

    it("should revert if client signs twice", async function () {
      await contracts.connect(client).signContract(contractId);
      await expect(
        contracts.connect(client).signContract(contractId)
      ).to.be.revertedWithCustomError(contracts, "AlreadySigned");
    });

    it("should revert if outsider tries to sign", async function () {
      await expect(
        contracts.connect(outsider).signContract(contractId)
      ).to.be.revertedWithCustomError(contracts, "NotAuthorized");
    });

    it("should revert signing on non-Draft contract", async function () {
      await signBothParties();
      // Now it's Signed — trying to sign again should fail
      await expect(
        contracts.connect(client).signContract(contractId)
      ).to.be.revertedWithCustomError(contracts, "InvalidStatus");
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 4. Activation (Funding)
  // ═════════════════════════════════════════════════════════════════
  describe("4. Activation", function () {
    beforeEach(async function () {
      await createDefaultContract();
      await signBothParties();
    });

    it("should transition to Active and transfer funds", async function () {
      const fee = (CONTRACT_AMOUNT * PLATFORM_FEE_BPS) / 10000n;
      await token
        .connect(client)
        .approve(await contracts.getAddress(), CONTRACT_AMOUNT + fee);

      const treasuryBefore = await token.balanceOf(treasury.address);
      const contractsBefore = await token.balanceOf(
        await contracts.getAddress()
      );

      await contracts.connect(client).activateContract(contractId);

      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_ACTIVE);
      expect(c.fundedAmount).to.equal(CONTRACT_AMOUNT);

      // Treasury received fee
      const treasuryAfter = await token.balanceOf(treasury.address);
      expect(treasuryAfter - treasuryBefore).to.equal(fee);

      // Contract holds the net amount
      const contractsAfter = await token.balanceOf(
        await contracts.getAddress()
      );
      expect(contractsAfter - contractsBefore).to.equal(CONTRACT_AMOUNT);
    });

    it("should emit ContractActivated with correct fee", async function () {
      const fee = (CONTRACT_AMOUNT * PLATFORM_FEE_BPS) / 10000n;
      await token
        .connect(client)
        .approve(await contracts.getAddress(), CONTRACT_AMOUNT + fee);
      await expect(contracts.connect(client).activateContract(contractId))
        .to.emit(contracts, "ContractActivated")
        .withArgs(contractId, CONTRACT_AMOUNT, fee);
    });

    it("should revert if not client", async function () {
      await token
        .connect(client)
        .approve(await contracts.getAddress(), CONTRACT_AMOUNT + 100n);
      await expect(
        contracts.connect(provider).activateContract(contractId)
      ).to.be.revertedWithCustomError(contracts, "NotAuthorized");
    });

    it("should revert if not Signed status", async function () {
      // Create and cancel another contract
      const id2 = ethers.keccak256(ethers.toUtf8Bytes("id2"));
      await contracts.connect(client).createContract(
        id2,
        provider.address,
        arbiter.address,
        CONTRACT_AMOUNT,
        termsHash,
        deadline,
        [MILESTONE_1, MILESTONE_2],
        [msDeadline1, msDeadline2]
      );
      // id2 is still Draft
      await expect(
        contracts.connect(client).activateContract(id2)
      ).to.be.revertedWithCustomError(contracts, "InvalidStatus");
    });

    it("should revert if deadline already passed", async function () {
      await time.increaseTo(deadline);
      await token
        .connect(client)
        .approve(await contracts.getAddress(), CONTRACT_AMOUNT + 100n);
      await expect(
        contracts.connect(client).activateContract(contractId)
      ).to.be.revertedWithCustomError(contracts, "DeadlineExpired");
    });

    it("should handle zero-fee (feeBps = 0)", async function () {
      // Set fee to 0
      await contracts.connect(admin).setPlatformFeeBps(0);
      await token
        .connect(client)
        .approve(await contracts.getAddress(), CONTRACT_AMOUNT);

      const treasuryBefore = await token.balanceOf(treasury.address);
      await contracts.connect(client).activateContract(contractId);
      const treasuryAfter = await token.balanceOf(treasury.address);
      expect(treasuryAfter - treasuryBefore).to.equal(0);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 5. Milestone Submission
  // ═════════════════════════════════════════════════════════════════
  describe("5. Milestone Submission", function () {
    beforeEach(async function () {
      await fullSetup();
    });

    it("should allow provider to submit a milestone", async function () {
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
      const m = await contracts.getMilestone(contractId, 0);
      expect(m.status).to.equal(MS_SUBMITTED);
      expect(m.deliverableHash).to.equal(deliverable1);
    });

    it("should emit MilestoneSubmitted event", async function () {
      await expect(
        contracts
          .connect(provider)
          .submitMilestone(contractId, 0, deliverable1)
      )
        .to.emit(contracts, "MilestoneSubmitted")
        .withArgs(contractId, 0, deliverable1);
    });

    it("should revert if not provider", async function () {
      await expect(
        contracts.connect(client).submitMilestone(contractId, 0, deliverable1)
      ).to.be.revertedWithCustomError(contracts, "NotAuthorized");
    });

    it("should revert for out-of-bounds milestone index", async function () {
      await expect(
        contracts.connect(provider).submitMilestone(contractId, 5, deliverable1)
      ).to.be.revertedWithCustomError(contracts, "MilestoneOutOfBounds");
    });

    it("should revert if milestone already approved", async function () {
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
      await contracts.connect(client).approveMilestone(contractId, 0);
      await expect(
        contracts
          .connect(provider)
          .submitMilestone(contractId, 0, deliverable2)
      ).to.be.revertedWithCustomError(contracts, "InvalidMilestoneStatus");
    });

    it("should allow re-submission after rejection", async function () {
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
      await contracts
        .connect(client)
        .rejectMilestone(contractId, 0, reason);
      // Re-submit
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable2);
      const m = await contracts.getMilestone(contractId, 0);
      expect(m.status).to.equal(MS_SUBMITTED);
      expect(m.deliverableHash).to.equal(deliverable2);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 6. Milestone Approval → Fund Release
  // ═════════════════════════════════════════════════════════════════
  describe("6. Milestone Approval", function () {
    beforeEach(async function () {
      await fullSetup();
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
    });

    it("should release milestone funds to provider on approval", async function () {
      const providerBefore = await token.balanceOf(provider.address);
      await contracts.connect(client).approveMilestone(contractId, 0);

      const providerAfter = await token.balanceOf(provider.address);
      expect(providerAfter - providerBefore).to.equal(MILESTONE_1);

      const c = await contracts.getContract(contractId);
      expect(c.releasedAmount).to.equal(MILESTONE_1);
    });

    it("should emit MilestoneApproved event", async function () {
      await expect(
        contracts.connect(client).approveMilestone(contractId, 0)
      )
        .to.emit(contracts, "MilestoneApproved")
        .withArgs(contractId, 0, MILESTONE_1);
    });

    it("should allow contract arbiter to approve", async function () {
      await contracts.connect(arbiter).approveMilestone(contractId, 0);
      const m = await contracts.getMilestone(contractId, 0);
      expect(m.status).to.equal(MS_APPROVED);
    });

    it("should allow global ARBITER_ROLE to approve", async function () {
      await contracts
        .connect(globalArbiter)
        .approveMilestone(contractId, 0);
      const m = await contracts.getMilestone(contractId, 0);
      expect(m.status).to.equal(MS_APPROVED);
    });

    it("should revert if provider tries to approve own milestone", async function () {
      await expect(
        contracts.connect(provider).approveMilestone(contractId, 0)
      ).to.be.revertedWithCustomError(contracts, "NotAuthorized");
    });

    it("should revert if milestone is not Submitted", async function () {
      // Milestone 1 is Pending
      await expect(
        contracts.connect(client).approveMilestone(contractId, 1)
      ).to.be.revertedWithCustomError(contracts, "InvalidMilestoneStatus");
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 7. Milestone Rejection
  // ═════════════════════════════════════════════════════════════════
  describe("7. Milestone Rejection", function () {
    beforeEach(async function () {
      await fullSetup();
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
    });

    it("should reject a submitted milestone", async function () {
      await contracts
        .connect(client)
        .rejectMilestone(contractId, 0, reason);
      const m = await contracts.getMilestone(contractId, 0);
      expect(m.status).to.equal(MS_REJECTED);
    });

    it("should emit MilestoneRejected event", async function () {
      await expect(
        contracts.connect(client).rejectMilestone(contractId, 0, reason)
      )
        .to.emit(contracts, "MilestoneRejected")
        .withArgs(contractId, 0, reason);
    });

    it("should revert if outsider tries to reject", async function () {
      await expect(
        contracts.connect(outsider).rejectMilestone(contractId, 0, reason)
      ).to.be.revertedWithCustomError(contracts, "NotAuthorized");
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 8. Contract Completion
  // ═════════════════════════════════════════════════════════════════
  describe("8. Contract Completion", function () {
    beforeEach(async function () {
      await fullSetup();
    });

    it("should complete when all milestones approved", async function () {
      // Submit + approve milestone 0
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
      await contracts.connect(client).approveMilestone(contractId, 0);

      // Submit + approve milestone 1
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 1, deliverable2);
      await contracts.connect(client).approveMilestone(contractId, 1);

      await contracts.connect(client).completeContract(contractId);

      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_COMPLETED);
      expect(c.releasedAmount).to.equal(CONTRACT_AMOUNT);
    });

    it("should emit ContractCompleted event", async function () {
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
      await contracts.connect(client).approveMilestone(contractId, 0);
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 1, deliverable2);
      await contracts.connect(client).approveMilestone(contractId, 1);

      await expect(contracts.connect(client).completeContract(contractId))
        .to.emit(contracts, "ContractCompleted")
        .withArgs(contractId, CONTRACT_AMOUNT);
    });

    it("should allow provider to call completeContract", async function () {
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
      await contracts.connect(client).approveMilestone(contractId, 0);
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 1, deliverable2);
      await contracts.connect(client).approveMilestone(contractId, 1);

      await contracts.connect(provider).completeContract(contractId);
      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_COMPLETED);
    });

    it("should revert if not all milestones approved", async function () {
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
      await contracts.connect(client).approveMilestone(contractId, 0);
      // Milestone 1 still Pending
      await expect(
        contracts.connect(client).completeContract(contractId)
      ).to.be.revertedWithCustomError(contracts, "NotAllMilestonesApproved");
    });

    it("should revert if outsider tries to complete", async function () {
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
      await contracts.connect(client).approveMilestone(contractId, 0);
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 1, deliverable2);
      await contracts.connect(client).approveMilestone(contractId, 1);

      await expect(
        contracts.connect(outsider).completeContract(contractId)
      ).to.be.revertedWithCustomError(contracts, "NotAuthorized");
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 9. Disputes
  // ═════════════════════════════════════════════════════════════════
  describe("9. Disputes", function () {
    beforeEach(async function () {
      await fullSetup();
    });

    it("should transition to Disputed", async function () {
      await contracts
        .connect(client)
        .disputeContract(contractId, evidenceHash);
      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_DISPUTED);
    });

    it("should emit ContractDisputed event", async function () {
      await expect(
        contracts.connect(client).disputeContract(contractId, evidenceHash)
      )
        .to.emit(contracts, "ContractDisputed")
        .withArgs(contractId, client.address, evidenceHash);
    });

    it("should allow provider to dispute", async function () {
      await contracts
        .connect(provider)
        .disputeContract(contractId, evidenceHash);
      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_DISPUTED);
    });

    it("should revert if outsider disputes", async function () {
      await expect(
        contracts.connect(outsider).disputeContract(contractId, evidenceHash)
      ).to.be.revertedWithCustomError(contracts, "NotAuthorized");
    });

    it("should revert if not Active", async function () {
      await contracts
        .connect(client)
        .disputeContract(contractId, evidenceHash);
      // Already Disputed
      await expect(
        contracts.connect(client).disputeContract(contractId, evidenceHash)
      ).to.be.revertedWithCustomError(contracts, "InvalidStatus");
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 10. Dispute Resolution
  // ═════════════════════════════════════════════════════════════════
  describe("10. Dispute Resolution", function () {
    beforeEach(async function () {
      await fullSetup();
      // Approve milestone 0 first, then dispute
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
      await contracts.connect(client).approveMilestone(contractId, 0);
      // Now dispute while milestone 1 is still pending
      await contracts
        .connect(client)
        .disputeContract(contractId, evidenceHash);
    });

    it("FavorProvider: should release remaining to provider → Completed", async function () {
      const remaining = CONTRACT_AMOUNT - MILESTONE_1; // MILESTONE_2
      const providerBefore = await token.balanceOf(provider.address);

      await contracts
        .connect(arbiter)
        .resolveDispute(contractId, DR_FAVOR_PROVIDER);

      const providerAfter = await token.balanceOf(provider.address);
      expect(providerAfter - providerBefore).to.equal(remaining);

      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_COMPLETED);
      expect(c.releasedAmount).to.equal(CONTRACT_AMOUNT);
    });

    it("FavorClient: should refund remaining to client → Terminated", async function () {
      const remaining = CONTRACT_AMOUNT - MILESTONE_1;
      const clientBefore = await token.balanceOf(client.address);

      await contracts
        .connect(arbiter)
        .resolveDispute(contractId, DR_FAVOR_CLIENT);

      const clientAfter = await token.balanceOf(client.address);
      expect(clientAfter - clientBefore).to.equal(remaining);

      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_TERMINATED);
    });

    it("Resume: should return to Active", async function () {
      await contracts
        .connect(arbiter)
        .resolveDispute(contractId, DR_RESUME);
      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_ACTIVE);
    });

    it("should emit DisputeResolved event", async function () {
      await expect(
        contracts
          .connect(arbiter)
          .resolveDispute(contractId, DR_FAVOR_PROVIDER)
      )
        .to.emit(contracts, "DisputeResolved")
        .withArgs(contractId, arbiter.address, DR_FAVOR_PROVIDER);
    });

    it("should allow global ARBITER_ROLE to resolve", async function () {
      await contracts
        .connect(globalArbiter)
        .resolveDispute(contractId, DR_RESUME);
      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_ACTIVE);
    });

    it("should revert if not arbiter", async function () {
      await expect(
        contracts.connect(client).resolveDispute(contractId, DR_RESUME)
      ).to.be.revertedWithCustomError(contracts, "NotAuthorized");
    });

    it("should revert if not Disputed", async function () {
      await contracts
        .connect(arbiter)
        .resolveDispute(contractId, DR_RESUME);
      // Now Active again
      await expect(
        contracts
          .connect(arbiter)
          .resolveDispute(contractId, DR_FAVOR_PROVIDER)
      ).to.be.revertedWithCustomError(contracts, "InvalidStatus");
    });

    it("after Resume, milestones can continue", async function () {
      await contracts
        .connect(arbiter)
        .resolveDispute(contractId, DR_RESUME);

      // Submit and approve milestone 1
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 1, deliverable2);
      await contracts.connect(client).approveMilestone(contractId, 1);

      await contracts.connect(client).completeContract(contractId);
      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_COMPLETED);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 11. Termination
  // ═════════════════════════════════════════════════════════════════
  describe("11. Termination", function () {
    beforeEach(async function () {
      await fullSetup();
    });

    it("should terminate Active contract and refund remaining", async function () {
      // Approve milestone 0, leave milestone 1
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
      await contracts.connect(client).approveMilestone(contractId, 0);

      const clientBefore = await token.balanceOf(client.address);
      await contracts
        .connect(client)
        .terminateContract(contractId, reason);

      const clientAfter = await token.balanceOf(client.address);
      expect(clientAfter - clientBefore).to.equal(MILESTONE_2); // remaining

      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_TERMINATED);
    });

    it("should emit ContractTerminated event", async function () {
      await expect(
        contracts.connect(client).terminateContract(contractId, reason)
      )
        .to.emit(contracts, "ContractTerminated")
        .withArgs(contractId, client.address, reason);
    });

    it("should allow provider to terminate", async function () {
      await contracts
        .connect(provider)
        .terminateContract(contractId, reason);
      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_TERMINATED);
    });

    it("should allow arbiter to terminate", async function () {
      await contracts
        .connect(arbiter)
        .terminateContract(contractId, reason);
      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_TERMINATED);
    });

    it("should allow admin to terminate", async function () {
      await contracts
        .connect(admin)
        .terminateContract(contractId, reason);
      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_TERMINATED);
    });

    it("should revert if outsider tries to terminate before deadline", async function () {
      await expect(
        contracts.connect(outsider).terminateContract(contractId, reason)
      ).to.be.revertedWithCustomError(contracts, "NotAuthorized");
    });

    it("should terminate Disputed contract", async function () {
      await contracts
        .connect(client)
        .disputeContract(contractId, evidenceHash);
      await contracts
        .connect(arbiter)
        .terminateContract(contractId, reason);
      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_TERMINATED);
    });

    it("should revert termination on Completed contract", async function () {
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
      await contracts.connect(client).approveMilestone(contractId, 0);
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 1, deliverable2);
      await contracts.connect(client).approveMilestone(contractId, 1);
      await contracts.connect(client).completeContract(contractId);

      await expect(
        contracts.connect(client).terminateContract(contractId, reason)
      ).to.be.revertedWithCustomError(contracts, "InvalidStatus");
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 12. Timeout Termination
  // ═════════════════════════════════════════════════════════════════
  describe("12. Timeout Termination", function () {
    beforeEach(async function () {
      await fullSetup();
    });

    it("should allow anyone to terminate after deadline", async function () {
      await time.increaseTo(deadline);
      await contracts
        .connect(outsider)
        .terminateContract(contractId, reason);
      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_TERMINATED);
    });

    it("should refund full amount on timeout if nothing released", async function () {
      const clientBefore = await token.balanceOf(client.address);
      await time.increaseTo(deadline);
      await contracts
        .connect(outsider)
        .terminateContract(contractId, reason);
      const clientAfter = await token.balanceOf(client.address);
      expect(clientAfter - clientBefore).to.equal(CONTRACT_AMOUNT);
    });

    it("should refund partial amount on timeout if some milestones released", async function () {
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
      await contracts.connect(client).approveMilestone(contractId, 0);

      const clientBefore = await token.balanceOf(client.address);
      await time.increaseTo(deadline);
      await contracts
        .connect(outsider)
        .terminateContract(contractId, reason);
      const clientAfter = await token.balanceOf(client.address);
      expect(clientAfter - clientBefore).to.equal(MILESTONE_2);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 13. Cancellation (pre-funding)
  // ═════════════════════════════════════════════════════════════════
  describe("13. Cancellation", function () {
    it("should cancel a Draft contract", async function () {
      await createDefaultContract();
      await contracts.connect(client).cancelContract(contractId);
      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_CANCELLED);
    });

    it("should cancel a Signed contract", async function () {
      await createDefaultContract();
      await signBothParties();
      await contracts.connect(provider).cancelContract(contractId);
      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_CANCELLED);
    });

    it("should emit ContractCancelled event", async function () {
      await createDefaultContract();
      await expect(contracts.connect(client).cancelContract(contractId))
        .to.emit(contracts, "ContractCancelled")
        .withArgs(contractId, client.address);
    });

    it("should revert cancellation on Active contract", async function () {
      await fullSetup();
      await expect(
        contracts.connect(client).cancelContract(contractId)
      ).to.be.revertedWithCustomError(contracts, "InvalidStatus");
    });

    it("should revert if outsider tries to cancel", async function () {
      await createDefaultContract();
      await expect(
        contracts.connect(outsider).cancelContract(contractId)
      ).to.be.revertedWithCustomError(contracts, "NotAuthorized");
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 14. View Functions
  // ═════════════════════════════════════════════════════════════════
  describe("14. View Functions", function () {
    it("getContract should revert for non-existent contract", async function () {
      const fakeId = ethers.keccak256(ethers.toUtf8Bytes("nonexistent"));
      await expect(
        contracts.getContract(fakeId)
      ).to.be.revertedWithCustomError(contracts, "ContractNotFound");
    });

    it("getMilestone should revert for out-of-bounds index", async function () {
      await createDefaultContract();
      await expect(
        contracts.getMilestone(contractId, 10)
      ).to.be.revertedWithCustomError(contracts, "MilestoneOutOfBounds");
    });

    it("getMilestones should return all milestones", async function () {
      await createDefaultContract();
      const ms = await contracts.getMilestones(contractId);
      expect(ms.length).to.equal(2);
    });

    it("calculateFee should return correct fee", async function () {
      const fee = await contracts.calculateFee(1000n);
      expect(fee).to.equal(10n); // 1% of 1000
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 15. Admin Functions
  // ═════════════════════════════════════════════════════════════════
  describe("15. Admin Functions", function () {
    it("should update platformFeeBps", async function () {
      await contracts.connect(admin).setPlatformFeeBps(200n);
      expect(await contracts.platformFeeBps()).to.equal(200n);
    });

    it("should update treasury", async function () {
      await contracts.connect(admin).setTreasury(outsider.address);
      expect(await contracts.treasury()).to.equal(outsider.address);
    });

    it("should revert setTreasury with zero address", async function () {
      await expect(
        contracts.connect(admin).setTreasury(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(contracts, "InvalidAddress");
    });

    it("should pause and unpause", async function () {
      await contracts.connect(admin).pause();
      await expect(
        createDefaultContract()
      ).to.be.revertedWithCustomError(contracts, "EnforcedPause");
      await contracts.connect(admin).unpause();
      await createDefaultContract();
    });

    it("should revert admin calls from non-admin", async function () {
      await expect(
        contracts.connect(outsider).setPlatformFeeBps(200n)
      ).to.be.reverted;
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 16. Invalid State Transitions
  // ═════════════════════════════════════════════════════════════════
  describe("16. Invalid State Transitions", function () {
    it("should revert submitMilestone on non-Active contract", async function () {
      await createDefaultContract();
      await expect(
        contracts
          .connect(provider)
          .submitMilestone(contractId, 0, deliverable1)
      ).to.be.revertedWithCustomError(contracts, "InvalidStatus");
    });

    it("should revert approveMilestone on non-Active contract", async function () {
      await createDefaultContract();
      await expect(
        contracts.connect(client).approveMilestone(contractId, 0)
      ).to.be.revertedWithCustomError(contracts, "InvalidStatus");
    });

    it("should revert completeContract on non-Active", async function () {
      await createDefaultContract();
      await expect(
        contracts.connect(client).completeContract(contractId)
      ).to.be.revertedWithCustomError(contracts, "InvalidStatus");
    });

    it("should revert disputeContract on Completed", async function () {
      await fullSetup();
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
      await contracts.connect(client).approveMilestone(contractId, 0);
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 1, deliverable2);
      await contracts.connect(client).approveMilestone(contractId, 1);
      await contracts.connect(client).completeContract(contractId);

      await expect(
        contracts.connect(client).disputeContract(contractId, evidenceHash)
      ).to.be.revertedWithCustomError(contracts, "InvalidStatus");
    });

    it("should revert signContract on Cancelled", async function () {
      await createDefaultContract();
      await contracts.connect(client).cancelContract(contractId);
      await expect(
        contracts.connect(provider).signContract(contractId)
      ).to.be.revertedWithCustomError(contracts, "InvalidStatus");
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 17. Full Lifecycle E2E
  // ═════════════════════════════════════════════════════════════════
  describe("17. Full Lifecycle E2E", function () {
    it("create → sign → activate → submit → approve → complete", async function () {
      // Create
      await createDefaultContract();

      // Sign
      await signBothParties();

      // Activate
      const fee = (CONTRACT_AMOUNT * PLATFORM_FEE_BPS) / 10000n;
      await token
        .connect(client)
        .approve(await contracts.getAddress(), CONTRACT_AMOUNT + fee);
      await contracts.connect(client).activateContract(contractId);

      // Submit + approve milestone 0
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
      await contracts.connect(client).approveMilestone(contractId, 0);

      // Reject + resubmit + approve milestone 1
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 1, deliverable2);
      await contracts
        .connect(client)
        .rejectMilestone(contractId, 1, reason);
      const betterDeliverable = ethers.keccak256(
        ethers.toUtf8Bytes("deliverable-2-v2")
      );
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 1, betterDeliverable);
      await contracts.connect(client).approveMilestone(contractId, 1);

      // Complete
      await contracts.connect(client).completeContract(contractId);

      // Verify final state
      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_COMPLETED);
      expect(c.releasedAmount).to.equal(CONTRACT_AMOUNT);
      expect(c.fundedAmount).to.equal(CONTRACT_AMOUNT);

      // Provider received full amount
      const providerBalance = await token.balanceOf(provider.address);
      expect(providerBalance).to.equal(CONTRACT_AMOUNT);
    });

    it("create → sign → activate → dispute → resolve (FavorClient)", async function () {
      await createDefaultContract();
      await signBothParties();

      const fee = (CONTRACT_AMOUNT * PLATFORM_FEE_BPS) / 10000n;
      await token
        .connect(client)
        .approve(await contracts.getAddress(), CONTRACT_AMOUNT + fee);
      await contracts.connect(client).activateContract(contractId);

      const clientBalBefore = await token.balanceOf(client.address);

      // Dispute
      await contracts
        .connect(provider)
        .disputeContract(contractId, evidenceHash);

      // Resolve: favor client
      await contracts
        .connect(arbiter)
        .resolveDispute(contractId, DR_FAVOR_CLIENT);

      const clientBalAfter = await token.balanceOf(client.address);
      expect(clientBalAfter - clientBalBefore).to.equal(CONTRACT_AMOUNT);

      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_TERMINATED);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 18. UUPS Upgrade Preserves State
  // ═════════════════════════════════════════════════════════════════
  describe("18. UUPS Upgrade", function () {
    it("should preserve state after upgrade", async function () {
      // Create and activate a contract
      await fullSetup();

      // Submit milestone 0
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
      await contracts.connect(client).approveMilestone(contractId, 0);

      // Record state
      const cBefore = await contracts.getContract(contractId);

      // Upgrade to same implementation (simulates upgrade)
      const NewFactory = await ethers.getContractFactory("ClawContracts");
      const upgraded = (await upgrades.upgradeProxy(
        await contracts.getAddress(),
        NewFactory
      )) as unknown as ClawContracts;

      // Verify state preserved
      const cAfter = await upgraded.getContract(contractId);
      expect(cAfter.client).to.equal(cBefore.client);
      expect(cAfter.provider).to.equal(cBefore.provider);
      expect(cAfter.totalAmount).to.equal(cBefore.totalAmount);
      expect(cAfter.releasedAmount).to.equal(cBefore.releasedAmount);
      expect(cAfter.status).to.equal(cBefore.status);

      // Continue operation after upgrade
      await upgraded
        .connect(provider)
        .submitMilestone(contractId, 1, deliverable2);
      await upgraded.connect(client).approveMilestone(contractId, 1);
      await upgraded.connect(client).completeContract(contractId);

      const cFinal = await upgraded.getContract(contractId);
      expect(cFinal.status).to.equal(CS_COMPLETED);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 19. Edge Cases
  // ═════════════════════════════════════════════════════════════════
  describe("19. Edge Cases", function () {
    it("should handle single-milestone contract", async function () {
      const now = await time.latest();
      const singleId = ethers.keccak256(ethers.toUtf8Bytes("single"));
      await contracts.connect(client).createContract(
        singleId,
        provider.address,
        arbiter.address,
        500n,
        termsHash,
        now + 86400,
        [500n],
        [now + 86400]
      );

      await contracts.connect(client).signContract(singleId);
      await contracts.connect(provider).signContract(singleId);

      const fee = (500n * PLATFORM_FEE_BPS) / 10000n;
      await token
        .connect(client)
        .approve(await contracts.getAddress(), 500n + fee);
      await contracts.connect(client).activateContract(singleId);

      await contracts
        .connect(provider)
        .submitMilestone(singleId, 0, deliverable1);
      await contracts.connect(client).approveMilestone(singleId, 0);
      await contracts.connect(client).completeContract(singleId);

      const c = await contracts.getContract(singleId);
      expect(c.status).to.equal(CS_COMPLETED);
    });

    it("FavorProvider with no remaining funds is a no-op transfer", async function () {
      await fullSetup();

      // Approve both milestones → all funds released
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 0, deliverable1);
      await contracts.connect(client).approveMilestone(contractId, 0);
      await contracts
        .connect(provider)
        .submitMilestone(contractId, 1, deliverable2);
      await contracts.connect(client).approveMilestone(contractId, 1);

      // Dispute after all released
      // Actually, can't dispute — all milestones approved, can complete.
      // But contract is still Active. Let's dispute before completing.
      await contracts
        .connect(client)
        .disputeContract(contractId, evidenceHash);

      // FavorProvider with 0 remaining
      const providerBefore = await token.balanceOf(provider.address);
      await contracts
        .connect(arbiter)
        .resolveDispute(contractId, DR_FAVOR_PROVIDER);
      const providerAfter = await token.balanceOf(provider.address);
      expect(providerAfter - providerBefore).to.equal(0);

      const c = await contracts.getContract(contractId);
      expect(c.status).to.equal(CS_COMPLETED);
    });

    it("should handle multiple contracts simultaneously", async function () {
      const id1 = ethers.keccak256(ethers.toUtf8Bytes("multi-1"));
      const id2 = ethers.keccak256(ethers.toUtf8Bytes("multi-2"));
      const now = await time.latest();
      const dl = now + 86400;

      // Create two contracts
      await contracts.connect(client).createContract(
        id1,
        provider.address,
        arbiter.address,
        200n,
        termsHash,
        dl,
        [200n],
        [dl]
      );
      await contracts.connect(client).createContract(
        id2,
        provider.address,
        arbiter.address,
        300n,
        termsHash,
        dl,
        [300n],
        [dl]
      );

      // They should be independent
      const c1 = await contracts.getContract(id1);
      const c2 = await contracts.getContract(id2);
      expect(c1.totalAmount).to.equal(200n);
      expect(c2.totalAmount).to.equal(300n);
    });
  });
});
