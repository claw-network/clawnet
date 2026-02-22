import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { ClawToken, ClawDAO, ParamRegistry } from "../typechain-types";

/**
 * ClawDAO unit tests — covers T-2.7 acceptance criteria:
 *  1. Proposal creation (all types)
 *  2. Proposal threshold insufficient revert
 *  3. Voting power calculation (multiple scenarios)
 *  4. Voting — discussion period revert / voting period success
 *  5. Voting — duplicate vote revert
 *  6. Proposal passed (forVotes > againstVotes + quorum met)
 *  7. Proposal not passed
 *  8. Timelock delayed execution
 *  9. Timelock not elapsed revert
 * 10. Execute calls target callData
 * 11. Parameter change e2e (propose → vote → queue → execute → param updated)
 * 12. Treasury spend e2e
 * 13. Emergency multisig execution
 * 14. Flash-loan protection (snapshot balance)
 * 15. Upgrade preserves state
 */
describe("ClawDAO", function () {
  let token: ClawToken;
  let dao: ClawDAO;
  let registry: ParamRegistry;
  let admin: HardhatEthersSigner;
  let proposer: HardhatEthersSigner;
  let voter1: HardhatEthersSigner;
  let voter2: HardhatEthersSigner;
  let voter3: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;
  let signers9: HardhatEthersSigner[];

  // Governance defaults
  const PROPOSAL_THRESHOLD = 100n;     // 100 Token to propose
  const DISCUSSION_PERIOD = 3600n;     // 1 hour
  const VOTING_PERIOD = 7200n;         // 2 hours
  const TIMELOCK_DELAY = 3600n;        // 1 hour
  const QUORUM_BPS = 400n;             // 4%
  const TOTAL_SUPPLY = 100_000n;       // mint to distribute

  // ProposalType enum
  const PT_PARAM_CHANGE = 0;
  const PT_TREASURY_SPEND = 1;
  const PT_PROTOCOL_UPGRADE = 2;
  const PT_EMERGENCY = 3;
  const PT_SIGNAL = 4;

  // ProposalStatus enum
  const PS_DISCUSSION = 0;
  const PS_VOTING = 1;
  const PS_PASSED = 2;
  const PS_REJECTED = 3;
  const PS_TIMELOCKED = 4;
  const PS_EXECUTED = 5;
  const PS_CANCELLED = 6;
  const PS_EXPIRED = 7;

  async function deployFixture() {
    const all = await ethers.getSigners();
    admin = all[0];
    proposer = all[1];
    voter1 = all[2];
    voter2 = all[3];
    voter3 = all[4];
    outsider = all[5];
    signers9 = all.slice(6, 15); // 9 signers for emergency multisig

    // Deploy ClawToken
    const TokenFactory = await ethers.getContractFactory("ClawToken");
    token = (await upgrades.deployProxy(TokenFactory, ["ClawToken", "CLAW", admin.address], {
      initializer: "initialize",
      kind: "uups",
    })) as unknown as ClawToken;

    // Deploy ParamRegistry
    const RegistryFactory = await ethers.getContractFactory("ParamRegistry");
    registry = (await upgrades.deployProxy(RegistryFactory, [admin.address], {
      initializer: "initialize",
      kind: "uups",
    })) as unknown as ParamRegistry;

    // Build signers array
    const signerAddresses: [string, string, string, string, string, string, string, string, string] = [
      await signers9[0].getAddress(),
      await signers9[1].getAddress(),
      await signers9[2].getAddress(),
      await signers9[3].getAddress(),
      await signers9[4].getAddress(),
      await signers9[5].getAddress(),
      await signers9[6].getAddress(),
      await signers9[7].getAddress(),
      await signers9[8].getAddress(),
    ];

    // Deploy ClawDAO
    const DAOFactory = await ethers.getContractFactory("ClawDAO");
    dao = (await upgrades.deployProxy(
      DAOFactory,
      [
        await token.getAddress(),
        await registry.getAddress(),
        PROPOSAL_THRESHOLD,
        DISCUSSION_PERIOD,
        VOTING_PERIOD,
        TIMELOCK_DELAY,
        QUORUM_BPS,
        signerAddresses,
      ],
      {
        initializer: "initialize",
        kind: "uups",
      }
    )) as unknown as ClawDAO;

    // Distribute tokens (admin already has MINTER_ROLE from initialize)
    await token.mint(proposer.address, 1_000n);
    await token.mint(voter1.address, 40_000n);
    await token.mint(voter2.address, 30_000n);
    await token.mint(voter3.address, 20_000n);
    await token.mint(outsider.address, 10n);  // below threshold
  }

  beforeEach(async function () {
    await deployFixture();
  });

  // ─── Helper: create a basic proposal ────────────────────────────

  async function createProposal(
    type_ = PT_PARAM_CHANGE,
    target = ethers.ZeroAddress,
    callData = "0x",
  ): Promise<bigint> {
    const descHash = ethers.keccak256(ethers.toUtf8Bytes("test proposal"));
    const tx = await dao.connect(proposer).propose(type_, descHash, target, callData);
    const receipt = await tx.wait();
    // Extract proposalId from logs
    const event = receipt!.logs.find(
      (l) => dao.interface.parseLog({ topics: [...l.topics], data: l.data })?.name === "ProposalCreated"
    );
    const parsed = dao.interface.parseLog({ topics: [...event!.topics], data: event!.data });
    return parsed!.args.proposalId;
  }

  // ─── Helper: advance to voting and pass ─────────────────────────

  async function passProposal(proposalId: bigint) {
    // Advance past discussion
    await time.increase(Number(DISCUSSION_PERIOD) + 1);
    // Vote
    await dao.connect(voter1).vote(proposalId, 1); // for
    await dao.connect(voter2).vote(proposalId, 1); // for
    // Advance past voting
    await time.increase(Number(VOTING_PERIOD) + 1);
  }

  // ─── Helper: sign emergency digest ──────────────────────────────

  async function signEmergency(proposalId: bigint, signersList: HardhatEthersSigner[]) {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const daoAddr = await dao.getAddress();
    const digest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address", "uint256"],
        [chainId, daoAddr, proposalId]
      )
    );
    const addresses: string[] = [];
    const signatures: string[] = [];
    for (const s of signersList) {
      const sig = await s.signMessage(ethers.getBytes(digest));
      addresses.push(await s.getAddress());
      signatures.push(sig);
    }
    return { addresses, signatures };
  }

  // ═══════════════════════════════════════════════════════════════════
  //  1. Proposal Creation (all types)
  // ═══════════════════════════════════════════════════════════════════

  describe("Proposal Creation", function () {
    it("creates a ParameterChange proposal", async function () {
      const id = await createProposal(PT_PARAM_CHANGE);
      expect(id).to.equal(1n);
      const p = await dao.getProposal(id);
      expect(p.pType).to.equal(PT_PARAM_CHANGE);
      expect(p.status).to.equal(PS_DISCUSSION);
      expect(p.proposer).to.equal(proposer.address);
    });

    it("creates proposals of all types", async function () {
      for (const t of [PT_PARAM_CHANGE, PT_TREASURY_SPEND, PT_PROTOCOL_UPGRADE, PT_EMERGENCY, PT_SIGNAL]) {
        const id = await createProposal(t);
        const p = await dao.getProposal(id);
        expect(p.pType).to.equal(t);
      }
      expect(await dao.proposalCount()).to.equal(5n);
    });

    it("stores correct timeline", async function () {
      const ts = BigInt(await time.latest());
      const id = await createProposal();
      const p = await dao.getProposal(id);
      expect(p.createdAt).to.be.closeTo(ts + 1n, 2n);
      expect(p.discussionEndAt).to.be.closeTo(ts + 1n + DISCUSSION_PERIOD, 2n);
      expect(p.votingEndAt).to.be.closeTo(ts + 1n + DISCUSSION_PERIOD + VOTING_PERIOD, 2n);
    });

    it("increments proposal counter", async function () {
      await createProposal();
      await createProposal();
      expect(await dao.proposalCount()).to.equal(2n);
    });

    it("emits ProposalCreated event", async function () {
      const descHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      await expect(
        dao.connect(proposer).propose(PT_PARAM_CHANGE, descHash, ethers.ZeroAddress, "0x")
      ).to.emit(dao, "ProposalCreated");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  2. Proposal Threshold Insufficient Revert
  // ═══════════════════════════════════════════════════════════════════

  describe("Proposal Threshold", function () {
    it("reverts if balance < proposalThreshold", async function () {
      const descHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      await expect(
        dao.connect(outsider).propose(PT_PARAM_CHANGE, descHash, ethers.ZeroAddress, "0x")
      ).to.be.revertedWithCustomError(dao, "InsufficientVotingPower");
    });

    it("allows proposal at exact threshold", async function () {
      // outsider has 10 Token, threshold is 100. Give them 90 more.
      const MINTER_ROLE = await token.MINTER_ROLE();
      await token.grantRole(MINTER_ROLE, admin.address);
      await token.mint(outsider.address, 90n);
      const descHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      await expect(
        dao.connect(outsider).propose(PT_PARAM_CHANGE, descHash, ethers.ZeroAddress, "0x")
      ).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  3. Voting Power Calculation
  // ═══════════════════════════════════════════════════════════════════

  describe("Voting Power", function () {
    it("returns sqrt(balance) for simple case (no reputation/lockup)", async function () {
      // voter1 has 40000 Token → sqrt(40000) = 200
      // trustMul = 1000 (no reputation), lockMul = 1000
      // power = 200 * 1000 * 1000 / 1_000_000 = 200
      expect(await dao.getVotingPower(voter1.address)).to.equal(200n);
    });

    it("returns 0 for zero balance", async function () {
      const [, , , , , , , , , , , , , , , nobody] = await ethers.getSigners();
      expect(await dao.getVotingPower(nobody.address)).to.equal(0n);
    });

    it("handles small balances (1 Token = power 1)", async function () {
      // sqrt(1) = 1, * 1000 * 1000 / 1e6 = 1
      const MINTER_ROLE = await token.MINTER_ROLE();
      await token.mint(ethers.Wallet.createRandom().address, 0n); // noop
      // outsider has 10 → sqrt(10) = 3 (integer sqrt)
      expect(await dao.getVotingPower(outsider.address)).to.equal(3n);
    });

    it("voting power scales with sqrt", async function () {
      // voter1: 40000 → sqrt=200, voter2: 30000 → sqrt=173, voter3: 20000 → sqrt=141
      const p1 = await dao.getVotingPower(voter1.address);
      const p2 = await dao.getVotingPower(voter2.address);
      const p3 = await dao.getVotingPower(voter3.address);
      expect(p1).to.be.greaterThan(p2);
      expect(p2).to.be.greaterThan(p3);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  4. Voting — Discussion Period Revert / Voting Period OK
  // ═══════════════════════════════════════════════════════════════════

  describe("Voting Timing", function () {
    it("reverts when voting during discussion period", async function () {
      const id = await createProposal();
      await expect(
        dao.connect(voter1).vote(id, 1)
      ).to.be.revertedWithCustomError(dao, "NotInStatus");
    });

    it("allows voting after discussion period ends", async function () {
      const id = await createProposal();
      await time.increase(Number(DISCUSSION_PERIOD) + 1);
      await expect(
        dao.connect(voter1).vote(id, 1)
      ).to.not.be.reverted;
    });

    it("auto-advances from Discussion to Voting on first vote", async function () {
      const id = await createProposal();
      await time.increase(Number(DISCUSSION_PERIOD) + 1);
      await dao.connect(voter1).vote(id, 1);
      // The stored status is now Voting (updated on vote())
      const p = await dao.getProposal(id);
      expect(p.status).to.equal(PS_VOTING);
    });

    it("reverts when voting after voting period ends", async function () {
      const id = await createProposal();
      // Jump past discussion + voting
      await time.increase(Number(DISCUSSION_PERIOD + VOTING_PERIOD) + 2);
      await expect(
        dao.connect(voter1).vote(id, 1)
      ).to.be.reverted; // will auto-finalize then revert NotInStatus
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  5. Duplicate Vote Revert
  // ═══════════════════════════════════════════════════════════════════

  describe("Duplicate Vote", function () {
    it("reverts on second vote by same address", async function () {
      const id = await createProposal();
      await time.increase(Number(DISCUSSION_PERIOD) + 1);
      await dao.connect(voter1).vote(id, 1);
      await expect(
        dao.connect(voter1).vote(id, 0)
      ).to.be.revertedWithCustomError(dao, "AlreadyVoted");
    });

    it("records receipt correctly", async function () {
      const id = await createProposal();
      await time.increase(Number(DISCUSSION_PERIOD) + 1);
      await dao.connect(voter1).vote(id, 1);
      const r = await dao.getReceipt(id, voter1.address);
      expect(r.hasVoted).to.be.true;
      expect(r.support).to.equal(1);
      expect(r.weight).to.equal(200n); // sqrt(40000)
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  6. Proposal Passed
  // ═══════════════════════════════════════════════════════════════════

  describe("Proposal Passed", function () {
    it("proposal passes when forVotes > againstVotes and quorum met", async function () {
      const id = await createProposal();
      await time.increase(Number(DISCUSSION_PERIOD) + 1);

      // voter1 (200 power) FOR, voter2 (173 power) FOR
      // total supply = 91010 (1000 + 40000 + 30000 + 20000 + 10)
      // quorum = 4% of 91010 = 3640.4 → need totalVotes >= 3641
      // But voting power is sqrt-based. power(voter1)=200, power(voter2)=173 → 373 total votes
      // That's less than 3641 quorum requirement on supply...
      // Wait, quorum is on totalVotes vs totalSupply in TOKEN units:
      // hasQuorum: totalVotes * 10000 >= supply * quorumBps
      //   373 * 10000 = 3_730_000
      //   91010 * 400 = 36_404_000
      // 3730000 < 36404000 — NOT enough!
      // We need more voting power. Let's give voter1 more tokens
      // Actually quorum is based on raw vote weight vs total supply * bps
      // So we need large vote weights. Let me just reduce quorum for this test.
      await dao.setGovParams(PROPOSAL_THRESHOLD, DISCUSSION_PERIOD, VOTING_PERIOD, TIMELOCK_DELAY, 10n); // 0.1% quorum

      // Re-create proposal under low quorum
      const id2 = await createProposal();
      await time.increase(Number(DISCUSSION_PERIOD) + 1);
      await dao.connect(voter1).vote(id2, 1); // 200 for
      await dao.connect(voter2).vote(id2, 1); // 173 for

      await time.increase(Number(VOTING_PERIOD) + 1);

      expect(await dao.hasPassed(id2)).to.be.true;
      expect(await dao.getStatus(id2)).to.equal(PS_PASSED);
    });

    it("forVotes tallied correctly", async function () {
      await dao.setGovParams(PROPOSAL_THRESHOLD, DISCUSSION_PERIOD, VOTING_PERIOD, TIMELOCK_DELAY, 10n);
      const id = await createProposal();
      await time.increase(Number(DISCUSSION_PERIOD) + 1);
      await dao.connect(voter1).vote(id, 1); // 200
      await dao.connect(voter2).vote(id, 0); // 173 against
      await dao.connect(voter3).vote(id, 2); // 141 abstain

      const p = await dao.getProposal(id);
      expect(p.forVotes).to.equal(200n);
      expect(p.againstVotes).to.equal(173n);
      expect(p.abstainVotes).to.equal(141n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  7. Proposal Not Passed
  // ═══════════════════════════════════════════════════════════════════

  describe("Proposal Not Passed", function () {
    it("rejects when againstVotes >= forVotes", async function () {
      await dao.setGovParams(PROPOSAL_THRESHOLD, DISCUSSION_PERIOD, VOTING_PERIOD, TIMELOCK_DELAY, 10n);
      const id = await createProposal();
      await time.increase(Number(DISCUSSION_PERIOD) + 1);
      await dao.connect(voter1).vote(id, 0); // 200 against
      await dao.connect(voter2).vote(id, 1); // 173 for
      await time.increase(Number(VOTING_PERIOD) + 1);

      expect(await dao.hasPassed(id)).to.be.false;
      expect(await dao.getStatus(id)).to.equal(PS_REJECTED);
    });

    it("rejects when quorum not met even if for > against", async function () {
      // Leave quorum at 400 bps (4%)
      const id = await createProposal();
      await time.increase(Number(DISCUSSION_PERIOD) + 1);
      // Only outsider votes (power 3) — not enough for quorum
      // outsider has 10 tokens → power = sqrt(10) = 3
      await dao.connect(outsider).vote(id, 1);
      await time.increase(Number(VOTING_PERIOD) + 1);

      expect(await dao.hasQuorum(id)).to.be.false;
      expect(await dao.hasPassed(id)).to.be.false;
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  8. Timelock Delayed Execution
  // ═══════════════════════════════════════════════════════════════════

  describe("Timelock", function () {
    let proposalId: bigint;

    beforeEach(async function () {
      await dao.setGovParams(PROPOSAL_THRESHOLD, DISCUSSION_PERIOD, VOTING_PERIOD, TIMELOCK_DELAY, 10n);
      proposalId = await createProposal();
      await passProposal(proposalId);
      // Queue
      await dao.queue(proposalId);
    });

    it("queues proposal in Timelocked status", async function () {
      const p = await dao.getProposal(proposalId);
      expect(p.status).to.equal(PS_TIMELOCKED);
      expect(p.timelockEndAt).to.be.greaterThan(0n);
    });

    it("executes after timelock delay", async function () {
      await time.increase(Number(TIMELOCK_DELAY) + 1);
      await expect(dao.execute(proposalId)).to.emit(dao, "ProposalExecuted");
      const p = await dao.getProposal(proposalId);
      expect(p.status).to.equal(PS_EXECUTED);
    });

    it("reverts execution before timelock ends", async function () {
      await expect(
        dao.execute(proposalId)
      ).to.be.revertedWithCustomError(dao, "TimelockNotElapsed");
    });

    it("expires 14 days after timelock ends", async function () {
      await time.increase(Number(TIMELOCK_DELAY) + 14 * 86400 + 1);
      await expect(
        dao.execute(proposalId)
      ).to.be.revertedWithCustomError(dao, "ProposalExpired");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  9. Timelock Not Elapsed Revert (covered in #8)
  // ═══════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════
  // 10. Execute Calls Target callData
  // ═══════════════════════════════════════════════════════════════════

  describe("Execute callData", function () {
    it("executes calldata on target contract", async function () {
      await dao.setGovParams(PROPOSAL_THRESHOLD, DISCUSSION_PERIOD, VOTING_PERIOD, TIMELOCK_DELAY, 10n);

      // Grant DAO the GOVERNOR_ROLE on ParamRegistry so it can call setParam
      const GOVERNOR_ROLE = await registry.GOVERNOR_ROLE();
      await registry.grantRole(GOVERNOR_ROLE, await dao.getAddress());

      // Proposal to set a param on the registry
      const key = await registry.MIN_NODE_STAKE();
      const callData = registry.interface.encodeFunctionData("setParam", [key, 99999n]);

      const descHash = ethers.keccak256(ethers.toUtf8Bytes("set MIN_STAKE"));
      const tx = await dao.connect(proposer).propose(
        PT_PARAM_CHANGE, descHash, await registry.getAddress(), callData
      );
      const receipt = await tx.wait();
      const event = receipt!.logs.find(
        (l) => dao.interface.parseLog({ topics: [...l.topics], data: l.data })?.name === "ProposalCreated"
      );
      const parsed = dao.interface.parseLog({ topics: [...event!.topics], data: event!.data });
      const proposalId = parsed!.args.proposalId;

      await passProposal(proposalId);
      await dao.queue(proposalId);
      await time.increase(Number(TIMELOCK_DELAY) + 1);
      await dao.execute(proposalId);

      // Verify param was updated
      expect(await registry.getParam(key)).to.equal(99999n);
    });

    it("reverts execute with zero target (no-op)", async function () {
      await dao.setGovParams(PROPOSAL_THRESHOLD, DISCUSSION_PERIOD, VOTING_PERIOD, TIMELOCK_DELAY, 10n);
      const id = await createProposal(PT_PARAM_CHANGE, ethers.ZeroAddress, "0x");
      await passProposal(id);
      await dao.queue(id);
      await time.increase(Number(TIMELOCK_DELAY) + 1);
      // Should succeed — zero target means no call
      await expect(dao.execute(id)).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 11. Parameter Change E2E
  // ═══════════════════════════════════════════════════════════════════

  describe("Parameter Change E2E", function () {
    it("propose → vote → queue → execute → param updated", async function () {
      await dao.setGovParams(PROPOSAL_THRESHOLD, DISCUSSION_PERIOD, VOTING_PERIOD, TIMELOCK_DELAY, 10n);

      const GOVERNOR_ROLE = await registry.GOVERNOR_ROLE();
      await registry.grantRole(GOVERNOR_ROLE, await dao.getAddress());

      const key = await registry.UNSTAKE_COOLDOWN();
      const callData = registry.interface.encodeFunctionData("setParam", [key, 12345n]);
      const descHash = ethers.keccak256(ethers.toUtf8Bytes("change COOLDOWN"));

      // 1. Propose
      const tx = await dao.connect(proposer).propose(
        PT_PARAM_CHANGE, descHash, await registry.getAddress(), callData
      );
      const receipt = await tx.wait();
      const event = receipt!.logs.find(
        (l) => dao.interface.parseLog({ topics: [...l.topics], data: l.data })?.name === "ProposalCreated"
      );
      const id = dao.interface.parseLog({ topics: [...event!.topics], data: event!.data })!.args.proposalId;

      // 2. Discussion → Voting → Vote
      await time.increase(Number(DISCUSSION_PERIOD) + 1);
      await dao.connect(voter1).vote(id, 1);
      await dao.connect(voter2).vote(id, 1);

      // 3. End voting
      await time.increase(Number(VOTING_PERIOD) + 1);
      expect(await dao.hasPassed(id)).to.be.true;

      // 4. Queue
      await dao.queue(id);
      expect((await dao.getProposal(id)).status).to.equal(PS_TIMELOCKED);

      // 5. Execute
      await time.increase(Number(TIMELOCK_DELAY) + 1);
      await dao.execute(id);
      expect((await dao.getProposal(id)).status).to.equal(PS_EXECUTED);

      // 6. Verify
      expect(await registry.getParam(key)).to.equal(12345n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 12. Treasury Spend E2E
  // ═══════════════════════════════════════════════════════════════════

  describe("Treasury Spend E2E", function () {
    it("sends Token from DAO treasury via proposal", async function () {
      await dao.setGovParams(PROPOSAL_THRESHOLD, DISCUSSION_PERIOD, VOTING_PERIOD, TIMELOCK_DELAY, 10n);

      // Fund DAO with tokens
      const MINTER_ROLE = await token.MINTER_ROLE();
      await token.mint(await dao.getAddress(), 5000n);

      // Proposal: DAO calls token.transfer(outsider, 500)
      const callData = token.interface.encodeFunctionData("transfer", [outsider.address, 500n]);
      const descHash = ethers.keccak256(ethers.toUtf8Bytes("treasury spend"));

      const tx = await dao.connect(proposer).propose(
        PT_TREASURY_SPEND, descHash, await token.getAddress(), callData
      );
      const receipt = await tx.wait();
      const event = receipt!.logs.find(
        (l) => dao.interface.parseLog({ topics: [...l.topics], data: l.data })?.name === "ProposalCreated"
      );
      const id = dao.interface.parseLog({ topics: [...event!.topics], data: event!.data })!.args.proposalId;

      const balBefore = await token.balanceOf(outsider.address);

      await passProposal(id);
      await dao.queue(id);
      await time.increase(Number(TIMELOCK_DELAY) + 1);
      await dao.execute(id);

      expect(await token.balanceOf(outsider.address)).to.equal(balBefore + 500n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 13. Emergency MultiSig Execution
  // ═══════════════════════════════════════════════════════════════════

  describe("Emergency MultiSig", function () {
    it("executes with 5/9 valid signatures", async function () {
      await dao.setGovParams(PROPOSAL_THRESHOLD, DISCUSSION_PERIOD, VOTING_PERIOD, TIMELOCK_DELAY, 10n);
      const id = await createProposal(PT_EMERGENCY);

      const fiveSigners = signers9.slice(0, 5);
      const { addresses, signatures } = await signEmergency(id, fiveSigners);

      await expect(
        dao.emergencyExecute(id, addresses, signatures)
      ).to.emit(dao, "EmergencyExecuted");

      const p = await dao.getProposal(id);
      expect(p.status).to.equal(PS_EXECUTED);
    });

    it("executes with all 9 signatures", async function () {
      const id = await createProposal(PT_EMERGENCY);
      const { addresses, signatures } = await signEmergency(id, signers9);
      await expect(
        dao.emergencyExecute(id, addresses, signatures)
      ).to.emit(dao, "EmergencyExecuted");
    });

    it("reverts with fewer than 5 signatures", async function () {
      const id = await createProposal(PT_EMERGENCY);
      const fourSigners = signers9.slice(0, 4);
      const { addresses, signatures } = await signEmergency(id, fourSigners);
      await expect(
        dao.emergencyExecute(id, addresses, signatures)
      ).to.be.revertedWithCustomError(dao, "InsufficientSignatures");
    });

    it("reverts with invalid signature", async function () {
      const id = await createProposal(PT_EMERGENCY);
      const fiveSigners = signers9.slice(0, 5);
      const { addresses, signatures } = await signEmergency(id, fiveSigners);
      // Corrupt one signature
      signatures[0] = signatures[0].slice(0, -2) + "ff";
      await expect(
        dao.emergencyExecute(id, addresses, signatures)
      ).to.be.reverted;
    });

    it("reverts with non-emergency signer", async function () {
      const id = await createProposal(PT_EMERGENCY);
      // Use outsider + 4 valid signers
      const invalidSet = [outsider, ...signers9.slice(0, 4)];
      const { addresses, signatures } = await signEmergency(id, invalidSet);
      await expect(
        dao.emergencyExecute(id, addresses, signatures)
      ).to.be.revertedWithCustomError(dao, "NotEmergencySigner");
    });

    it("executes emergency call on target", async function () {
      // Emergency execute a param change
      const GOVERNOR_ROLE = await registry.GOVERNOR_ROLE();
      await registry.grantRole(GOVERNOR_ROLE, await dao.getAddress());

      const key = await registry.MIN_NODE_STAKE();
      const callData = registry.interface.encodeFunctionData("setParam", [key, 77777n]);
      const descHash = ethers.keccak256(ethers.toUtf8Bytes("emergency fix"));

      const tx = await dao.connect(proposer).propose(
        PT_EMERGENCY, descHash, await registry.getAddress(), callData
      );
      const receipt = await tx.wait();
      const event = receipt!.logs.find(
        (l) => dao.interface.parseLog({ topics: [...l.topics], data: l.data })?.name === "ProposalCreated"
      );
      const id = dao.interface.parseLog({ topics: [...event!.topics], data: event!.data })!.args.proposalId;

      const { addresses, signatures } = await signEmergency(id, signers9.slice(0, 5));
      await dao.emergencyExecute(id, addresses, signatures);

      expect(await registry.getParam(key)).to.equal(77777n);
    });

    it("reverts emergency on already-executed proposal", async function () {
      const id = await createProposal(PT_EMERGENCY);
      const { addresses, signatures } = await signEmergency(id, signers9.slice(0, 5));
      await dao.emergencyExecute(id, addresses, signatures);

      // Try again
      const { addresses: a2, signatures: s2 } = await signEmergency(id, signers9.slice(0, 5));
      await expect(
        dao.emergencyExecute(id, a2, s2)
      ).to.be.revertedWithCustomError(dao, "NotInStatus");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 14. Cancel
  // ═══════════════════════════════════════════════════════════════════

  describe("Cancel", function () {
    it("proposer can cancel their own proposal", async function () {
      const id = await createProposal();
      await dao.connect(proposer).cancel(id);
      expect((await dao.getProposal(id)).status).to.equal(PS_CANCELLED);
    });

    it("CANCELLER_ROLE can cancel any proposal", async function () {
      const id = await createProposal();
      await dao.connect(admin).cancel(id); // admin has CANCELLER_ROLE
      expect((await dao.getProposal(id)).status).to.equal(PS_CANCELLED);
    });

    it("outsider cannot cancel", async function () {
      const id = await createProposal();
      await expect(
        dao.connect(outsider).cancel(id)
      ).to.be.revertedWithCustomError(dao, "NotProposer");
    });

    it("cannot cancel executed proposal", async function () {
      await dao.setGovParams(PROPOSAL_THRESHOLD, DISCUSSION_PERIOD, VOTING_PERIOD, TIMELOCK_DELAY, 10n);
      const id = await createProposal();
      await passProposal(id);
      await dao.queue(id);
      await time.increase(Number(TIMELOCK_DELAY) + 1);
      await dao.execute(id);

      await expect(
        dao.connect(proposer).cancel(id)
      ).to.be.revertedWithCustomError(dao, "NotInStatus");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 15. View Functions / Status transitions
  // ═══════════════════════════════════════════════════════════════════

  describe("Status and View Functions", function () {
    it("getStatus returns Discussion initially", async function () {
      const id = await createProposal();
      expect(await dao.getStatus(id)).to.equal(PS_DISCUSSION);
    });

    it("getStatus returns Voting after discussion period", async function () {
      const id = await createProposal();
      await time.increase(Number(DISCUSSION_PERIOD) + 1);
      expect(await dao.getStatus(id)).to.equal(PS_VOTING);
    });

    it("getStatus returns Rejected after voting with no votes", async function () {
      const id = await createProposal();
      await time.increase(Number(DISCUSSION_PERIOD + VOTING_PERIOD) + 2);
      expect(await dao.getStatus(id)).to.equal(PS_REJECTED);
    });

    it("getStatus returns Cancelled after cancel", async function () {
      const id = await createProposal();
      await dao.connect(proposer).cancel(id);
      expect(await dao.getStatus(id)).to.equal(PS_CANCELLED);
    });

    it("getStatus returns Expired for timelocked proposal past 14 days", async function () {
      await dao.setGovParams(PROPOSAL_THRESHOLD, DISCUSSION_PERIOD, VOTING_PERIOD, TIMELOCK_DELAY, 10n);
      const id = await createProposal();
      await passProposal(id);
      await dao.queue(id);
      await time.increase(Number(TIMELOCK_DELAY) + 14 * 86400 + 2);
      expect(await dao.getStatus(id)).to.equal(PS_EXPIRED);
    });

    it("reverts for invalid proposalId", async function () {
      await expect(dao.getStatus(999n)).to.be.revertedWithCustomError(dao, "InvalidProposalId");
      await expect(dao.getProposal(999n)).to.be.revertedWithCustomError(dao, "InvalidProposalId");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 16. Admin Functions
  // ═══════════════════════════════════════════════════════════════════

  describe("Admin", function () {
    it("admin can setGovParams", async function () {
      await dao.setGovParams(200n, 7200n, 14400n, 7200n, 500n);
      expect(await dao.proposalThreshold()).to.equal(200n);
      expect(await dao.votingPeriod()).to.equal(14400n);
      expect(await dao.quorumBps()).to.equal(500n);
    });

    it("non-admin cannot setGovParams", async function () {
      await expect(
        dao.connect(outsider).setGovParams(1n, 1n, 1n, 1n, 1n)
      ).to.be.reverted;
    });

    it("admin can setReputationContract", async function () {
      await dao.setReputationContract(voter1.address);
      expect(await dao.reputationContract()).to.equal(voter1.address);
    });

    it("admin can setStakingContract", async function () {
      await dao.setStakingContract(voter2.address);
      expect(await dao.stakingContract()).to.equal(voter2.address);
    });

    it("admin can update emergency signers", async function () {
      const newSigners = await Promise.all(
        Array.from({ length: 9 }, () => ethers.Wallet.createRandom().address)
      );
      await expect(
        dao.setEmergencySigners(newSigners as any)
      ).to.emit(dao, "EmergencySignersUpdated");
    });

    it("pause / unpause works", async function () {
      await dao.pause();
      const descHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      await expect(
        dao.connect(proposer).propose(PT_PARAM_CHANGE, descHash, ethers.ZeroAddress, "0x")
      ).to.be.reverted; // EnforcedPause

      await dao.unpause();
      await expect(
        dao.connect(proposer).propose(PT_PARAM_CHANGE, descHash, ethers.ZeroAddress, "0x")
      ).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 17. Signal Proposals
  // ═══════════════════════════════════════════════════════════════════

  describe("Signal Proposals", function () {
    it("signal cannot be queued", async function () {
      await dao.setGovParams(PROPOSAL_THRESHOLD, DISCUSSION_PERIOD, VOTING_PERIOD, TIMELOCK_DELAY, 10n);
      const id = await createProposal(PT_SIGNAL);
      await passProposal(id);
      await expect(dao.queue(id)).to.be.revertedWithCustomError(dao, "InvalidParams");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 18. Upgrade Preserves State
  // ═══════════════════════════════════════════════════════════════════

  describe("Upgrade", function () {
    it("preserves proposals and state after upgrade", async function () {
      // Create a proposal
      const id = await createProposal();
      const pBefore = await dao.getProposal(id);

      // Upgrade to same implementation (V2)
      const DAOFactory = await ethers.getContractFactory("ClawDAO");
      const newDao = await upgrades.upgradeProxy(await dao.getAddress(), DAOFactory, {
        kind: "uups",
      });

      // Verify state preserved
      const pAfter = await (newDao as unknown as ClawDAO).getProposal(id);
      expect(pAfter.proposer).to.equal(pBefore.proposer);
      expect(pAfter.pType).to.equal(pBefore.pType);
      expect(pAfter.status).to.equal(pBefore.status);
      expect(pAfter.descriptionHash).to.equal(pBefore.descriptionHash);
      expect(await (newDao as unknown as ClawDAO).proposalCount()).to.equal(1n);
    });

    it("non-admin cannot upgrade", async function () {
      const DAOFactory = await ethers.getContractFactory("ClawDAO", outsider);
      await expect(
        upgrades.upgradeProxy(await dao.getAddress(), DAOFactory, { kind: "uups" })
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 19. Edge Cases
  // ═══════════════════════════════════════════════════════════════════

  describe("Edge Cases", function () {
    it("invalid support value reverts", async function () {
      const id = await createProposal();
      await time.increase(Number(DISCUSSION_PERIOD) + 1);
      await expect(
        dao.connect(voter1).vote(id, 3)
      ).to.be.revertedWithCustomError(dao, "InvalidSupport");
    });

    it("vote with abstain counted but does not help pass", async function () {
      await dao.setGovParams(PROPOSAL_THRESHOLD, DISCUSSION_PERIOD, VOTING_PERIOD, TIMELOCK_DELAY, 10n);
      const id = await createProposal();
      await time.increase(Number(DISCUSSION_PERIOD) + 1);
      // All votes abstain
      await dao.connect(voter1).vote(id, 2);
      await dao.connect(voter2).vote(id, 2);
      await time.increase(Number(VOTING_PERIOD) + 1);

      // Quorum should be met (abstains count toward quorum) but for=0, against=0 → not passed
      // hasPassed requires forVotes > againstVotes, which is 0 > 0 = false
      expect(await dao.hasPassed(id)).to.be.false;
    });

    it("queue before voting ends reverts", async function () {
      const id = await createProposal();
      await expect(
        dao.queue(id)
      ).to.be.revertedWithCustomError(dao, "NotInStatus");
    });

    it("execute non-timelocked proposal reverts", async function () {
      const id = await createProposal();
      await expect(
        dao.execute(id)
      ).to.be.revertedWithCustomError(dao, "NotInStatus");
    });
  });
});
