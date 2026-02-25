ClawNet Smart Contract Security Audit Report
1. Executive Summary
Overall risk assessment: High
The codebase is generally structured with strong use of OpenZeppelin upgradeable primitives, but there are several security-significant logic issues in governance and identity that can directly undermine protocol trust assumptions. The most critical issue is governance vote inflation via transferable balances (no snapshot/locking), which can allow proposal outcomes to be manipulated without proportional economic stake.
Findings count
- Critical: 1
- High: 2
- Medium: 4
- Low: 1
- Informational: 2
- Total: 10
Scope confirmation (reviewed)
- packages/contracts/contracts/ClawToken.sol
- packages/contracts/contracts/ParamRegistry.sol
- packages/contracts/contracts/ClawEscrow.sol
- packages/contracts/contracts/ClawIdentity.sol
- packages/contracts/contracts/ClawStaking.sol
- packages/contracts/contracts/ClawReputation.sol
- packages/contracts/contracts/ClawDAO.sol
- packages/contracts/contracts/ClawContracts.sol
- packages/contracts/contracts/ClawRouter.sol
- packages/contracts/contracts/interfaces/IClawToken.sol
- packages/contracts/contracts/interfaces/IClawEscrow.sol
- packages/contracts/contracts/interfaces/IClawIdentity.sol
- packages/contracts/contracts/interfaces/IClawReputation.sol
- packages/contracts/contracts/interfaces/IClawStaking.sol
- packages/contracts/contracts/libraries/Ed25519Verifier.sol
- packages/contracts/contracts/libraries/ClawMerkle.sol
- docs/implementation/tasks/audit-documentation-pack.md
- docs/implementation/tasks/internal-audit-report.md
- docs/implementation/security.md
---
2. Findings
C-01 Governance vote inflation via transferable balances (no snapshot / no vote escrow)
- Severity: Critical
- Contract: ClawDAO.sol — vote() (ClawDAO.sol:241), getVotingPower() (ClawDAO.sol:378)
- Description:  
  Voting weight is computed from current token.balanceOf(voter) at vote time, and receipts only prevent same address double-voting. Tokens can be transferred after voting to another address, which can vote again with the same economic stake. This allows one balance to be reused across many addresses during the same proposal.
- Impact:  
  Proposal outcomes can be manipulated with artificially amplified voting weight, enabling governance capture and execution of arbitrary proposal payloads.
- Proof of Concept:
  1. Address A holds 10,000 TOKEN.
  2. A votes For on proposal P (weight ~sqrt(10000) = 100, before multipliers).
  3. A transfers 10,000 TOKEN to B.
  4. B votes For with the same effective base weight.
  5. Repeat across addresses C, D, ...; aggregate forVotes grows without adding net stake.
- Recommendation:  
  Use immutable snapshot voting (ERC20Votes / checkpointing) and always use getPastVotes(voter, snapshotBlock) where snapshotBlock is fixed at proposal creation.
    // Example pattern (token must support checkpoints)
  interface IVotesToken {
      function getPastVotes(address account, uint256 timepoint) external view returns (uint256);
      function getPastTotalSupply(uint256 timepoint) external view returns (uint256);
  }
  function _votingWeight(address voter, uint256 snapshotBlock) internal view returns (uint256) {
      uint256 bal = IVotesToken(address(token)).getPastVotes(voter, snapshotBlock);
      uint256 sqrtBal = _sqrt(bal);
      uint256 trustMul = 1000 + _getTrustScore(voter);
      uint256 lockMul = _getLockupMultiplier(voter);
      return (sqrtBal * trustMul * lockMul) / 1_000_000;
  }
  - Status: Open
---
H-01 DID registration/rotation lacks cryptographic proof-of-ownership
- Severity: High
- Contract: ClawIdentity.sol — registerDID() (ClawIdentity.sol:126), rotateKey() (ClawIdentity.sol:218)
- Description:  
  DID registration accepts arbitrary didHash + publicKey without verifying that caller controls the DID key material. rotateKey accepts rotationProof but does not verify it (rotationProof; no-op at ClawIdentity.sol:225).
- Impact:  
  DID squatting/hijacking is possible: an attacker can pre-register a victim DID hash and permanently block legitimate registration. Rotation proof is currently non-binding on-chain.
- Proof of Concept:
  1. Attacker computes victim DID hash off-chain.
  2. Calls registerDID(victimDidHash, attackerPubKey, ..., attackerAddr).
  3. Victim later tries to register same DID hash and reverts DIDAlreadyExists.
- Recommendation:  
  Enforce proof-of-possession at registration and rotation (Ed25519 precompile when available; temporary EVM signature gate otherwise).
    // Temporary EVM-bound authorization until Ed25519 precompile is live
  function registerDID(
      bytes32 didHash,
      bytes calldata publicKey,
      KeyPurpose purpose,
      address evmAddress,
      bytes calldata evmSig
  ) external {
      address controller = evmAddress == address(0) ? msg.sender : evmAddress;
      bytes32 digest = keccak256(abi.encodePacked("clawnet:register:v1:", didHash, controller));
      address recovered = ECDSA.recover(ECDSA.toEthSignedMessageHash(digest), evmSig);
      require(recovered == controller, "invalid controller authorization");
      // existing registration logic...
  }
  - Status: Open
---
H-02 Emergency path threshold weaker than stated trust model (5-of-9 vs required 9-of-9)
- Severity: High
- Contract: ClawDAO.sol — EMERGENCY_THRESHOLD (ClawDAO.sol:127), emergencyExecute() (ClawDAO.sol:352)
- Description:  
  Contract enforces EMERGENCY_THRESHOLD = 5, while engagement requirements and governance assumptions specify all 9 signatures for emergency actions.
- Impact:  
  Emergency execution bypasses normal voting and timelock; reducing signer threshold materially weakens governance safety and increases key-compromise blast radius.
- Proof of Concept:
  1. Prepare valid proposal payload.
  2. Collect signatures from any 5 authorized emergency signers.
  3. Call emergencyExecute and execute payload immediately.
- Recommendation:  
  Enforce 9-of-9 if that is the intended policy, or make threshold immutable at deployment with strict governance constraints and explicit documentation.
    uint8 public constant EMERGENCY_THRESHOLD = 9; // enforce policy
  // optionally add explicit invariant checks in initialize/setEmergencySigners
  require(EMERGENCY_THRESHOLD == 9, "threshold mismatch");
  - Status: Open
---
M-01 Disputed escrows can be permanently locked if arbiter is unavailable
- Severity: Medium
- Contract: ClawEscrow.sol — dispute() (ClawEscrow.sol:265), resolve() (ClawEscrow.sol:279), expire() (ClawEscrow.sol:250)
- Description:  
  Once escrow enters Disputed, only arbiter can resolve. expire() only works for Active escrows. No dispute timeout or fallback path exists.
- Impact:  
  Funds may become indefinitely locked if arbiter is inactive, compromised, or maliciously non-responsive.
- Proof of Concept:
  1. User creates escrow.
  2. Counterparty calls dispute() before expiry.
  3. Arbiter never calls resolve().
  4. Neither party can recover funds; expire() no longer applies.
- Recommendation:  
  Add disputeOpenedAt and a timeout-based fallback (client refund, split, or DAO/arbitration override).
    struct EscrowRecord {
      // ...
      uint64 disputeOpenedAt;
  }
  function dispute(bytes32 escrowId) external {
      // ...
      e.status = EscrowStatus.Disputed;
      e.disputeOpenedAt = uint64(block.timestamp);
  }
  function forceResolveAfterTimeout(bytes32 escrowId) external {
      EscrowRecord storage e = _getEscrow(escrowId);
      require(e.status == EscrowStatus.Disputed, "not disputed");
      require(block.timestamp >= e.disputeOpenedAt + 7 days, "timeout not reached");
      e.status = EscrowStatus.Refunded;
      token.safeTransfer(e.depositor, e.amount);
  }
  - Status: Open
---
M-02 Escrow fee model can be bypassed via zero-fee top-ups
- Severity: Medium
- Contract: ClawEscrow.sol — createEscrow() (ClawEscrow.sol:156), fund() (ClawEscrow.sol:201)
- Description:  
  Fees are charged only at creation; fund() adds principal without charging additional fee/holding component.
- Impact:  
  Users can create low-amount escrows (paying minimal fee), then top up large amounts fee-free, undermining protocol revenue and economic assumptions.
- Proof of Concept:
  1. Create escrow with minimal amount and short expiry.
  2. Pay minimal computed fee once.
  3. Call fund() repeatedly with large amounts.
  4. Release/refund full topped-up amount with no additional fee.
- Recommendation:  
  Charge incremental fee on fund() based on residual holding time, or disallow top-ups unless fee-adjusted.
    function fund(bytes32 escrowId, uint256 amount) external nonReentrant {
      EscrowRecord storage e = _getEscrow(escrowId);
      require(e.status == EscrowStatus.Active, "inactive");
      uint256 remainingDays = block.timestamp >= e.expiresAt ? 0 : (e.expiresAt - block.timestamp + 86399) / 86400;
      uint256 fee = _calculateFee(amount, remainingDays);
      token.safeTransferFrom(msg.sender, address(this), amount + fee);
      if (fee > 0) token.safeTransfer(treasury, fee);
      e.amount += amount;
  }
  - Status: Open
---
M-03 ClawRouter.multicall is an unrestricted arbitrary call forwarder (confused-deputy risk)
- Severity: Medium
- Contract: ClawRouter.sol — multicall() (ClawRouter.sol:180)
- Description:  
  Any caller can instruct router to call arbitrary targets. If router is ever granted privileged roles or accumulates assets, attacker can execute privileged operations through router identity.
- Impact:  
  Conditional privilege escalation / fund movement risk under common integration mistakes (future role grants to router, approvals, treasury transfers).
- Proof of Concept:
  1. A future deployment grants a role to router (operational mistake).
  2. Attacker calls multicall with payload for role-protected function.
  3. Target contract sees msg.sender == router and accepts call.
- Recommendation:  
  Restrict multicall scope: whitelist modules/selectors, add role gate, or keep only staticMulticall.
    bytes32 public constant MULTICALL_ROLE = keccak256("MULTICALL_ROLE");
  function multicall(address[] calldata targets, bytes[] calldata data)
      external
      onlyRole(MULTICALL_ROLE)
      returns (bytes[] memory results)
  {
      // existing loop
  }
  - Status: Open
---
M-04 Critical parameter updates lack safety bounds (can weaken governance or brick flows)
- Severity: Medium
- Contract: ClawDAO.sol — setGovParams() (ClawDAO.sol:465); ParamRegistry.sol — setParam() (ParamRegistry.sol:108)
- Description:  
  Parameter writes accept arbitrary values without invariant checks (e.g., quorumBps, timelockDelay, cooldown/fee extremes).
- Impact:  
  Misconfiguration (or malicious governance action) can set insecure/invalid values, including effectively disabling quorum or causing operational DoS.
- Proof of Concept:
  1. Governance/admin sets QUORUM_BPS = 0 (via registry) or extreme invalid values.
  2. Proposal validity rules become materially weaker or inconsistent.
  3. Protocol security/economic assumptions break.
- Recommendation:  
  Enforce per-key bounds and sanity checks at write time.
    function setGovParams(
      uint256 proposalThreshold_,
      uint64 discussionPeriod_,
      uint64 votingPeriod_,
      uint64 timelockDelay_,
      uint256 quorumBps_
  ) external onlyRole(DEFAULT_ADMIN_ROLE) {
      require(quorumBps_ >= 100 && quorumBps_ <= 4000, "quorum out of range");
      require(votingPeriod_ >= 1 days && votingPeriod_ <= 14 days, "voting period out of range");
      require(timelockDelay_ >= 12 hours && timelockDelay_ <= 7 days, "timelock out of range");
      // assign...
  }
  - Status: Open
---
L-01 Single-step admin trust transfer increases operational key-risk
- Severity: Low
- Contract: All AccessControlUpgradeable contracts
- Description:  
  DEFAULT_ADMIN_ROLE transfer relies on grant/revoke flow without a two-step acceptance guard.
- Impact:  
  Mistyped address or compromised hot key can cause governance lockout or takeover.
- Proof of Concept:
  1. Current admin grants admin role to wrong address.
  2. Revokes self.
  3. Contract admin control is lost.
- Recommendation:  
  Use AccessControlDefaultAdminRulesUpgradeable (with delay and two-step transfer) for production.
    import "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
  // replace AccessControlUpgradeable inheritance and initialize delay-based admin rules
  - Status: Open
---
I-01 Lockup multiplier path in DAO is currently non-functional
- Severity: Informational
- Contract: ClawDAO.sol — _getLockupMultiplier() (ClawDAO.sol:549), expects getLockupMultiplier(address)
- Description:  
  DAO calls stakingContract.getLockupMultiplier(address) via staticcall, but ClawStaking.sol does not implement this function. Path always falls back to 1000 (1x).
- Impact:  
  Governance weighting differs from documented formula; lockup incentive is not active.
- Proof of Concept:
  1. Set staking contract address in DAO.
  2. Call getVotingPower.
  3. Multiplier remains default due failed staticcall decoding path.
- Recommendation:  
  Implement and expose getLockupMultiplier(address) in staking, or remove multiplier term until implemented.
- Status: Open
---
I-02 Security documentation and implementation diverge on critical assumptions
- Severity: Informational
- Contract: Documentation + governance/security architecture
- Description:  
  Multiple doc/code mismatches exist:
  - Emergency signer threshold documented as stricter model but code uses 5-of-9.
  - Flash-loan/snapshot defense described, but DAO uses live balance at vote time.
  - Internal report claims router multicall role-gated (MULTICALL_ROLE), but contract has no such role.
- Impact:  
  Incorrect operator and user security assumptions; incident-response and governance procedures may be based on non-existent controls.
- Proof of Concept:  
  Compare docs/implementation/security.md with ClawDAO.sol:378 and ClawRouter.sol:180.
- Recommendation:  
  Align docs to code immediately, then update code to intended controls; add CI checks for security spec drift on critical invariants.
- Status: Open
---
3. Severity Definitions
- Critical: Direct loss of funds or permanent contract freeze, exploitable without special permissions  
- High: Conditional loss of funds, governance bypass, or severe DoS  
- Medium: Unexpected behavior, economic inefficiency, or exploitable with unlikely preconditions  
- Low: Best practice violations, gas inefficiency, or minor logic issues  
- Informational: Code quality, documentation, or style recommendations
---
4. Specific Area Analysis
4.1 Access Control
- Findings: H-02, M-03, L-01
- MINTER_ROLE on ClawToken is high-trust and effectively unlimited by design; strongly operationally sensitive.
- UUPS _authorizeUpgrade checks are present and role-gated in all 9 contracts.
- DEFAULT_ADMIN_ROLE hardening is recommended (two-step delayed admin).
4.2 Reentrancy
- No findings (direct exploitable reentrancy path not identified).
- ClawEscrow, ClawStaking, ClawContracts, ClawDAO correctly apply nonReentrant on token-transfering state mutators.
- State updates generally precede token transfers (CEI-compatible).
4.3 Economic Attacks
- Findings: C-01, M-02, M-04
- Escrow fee bypass via top-ups is economically exploitable.
- Governance/economic parameter ranges are not bounded.
- 0-decimal arithmetic itself is safe, but requires strict min/bound policies to prevent coarse-grained parameter shocks.
4.4 Governance (ClawDAO)
- Findings: C-01, H-02, M-04, I-01
- Proposal execution without sound vote accounting is possible due transferable-balance reuse.
- Timelock bypass through emergency path is explicit by design; threshold strength is the key control.
- Voting power snapshot/lock defenses are not implemented in current code.
4.5 Escrow & Service Contracts
- Findings: M-01, M-02
- Potential permanent lock in disputed escrows exists (arbiter liveness dependency).
- No double-claim observed in escrow terminal transitions.
- ClawContracts.cancelContract correctly blocks cancellation post-funding (only Draft/Signed).
4.6 Identity
- Findings: H-01
- DID ownership and key rotation proof are not cryptographically enforced on-chain in current implementation.
- Revoked DID reactivation path is not present (safe in that specific aspect).
4.7 Upgradeability
- No exploitable storage-collision finding identified in current version.
- Initializers are protected with _disableInitializers() constructors.
- Upgrade authorization is role-gated; compromise of admin remains systemic risk.
4.8 Denial of Service
- Findings: M-01
- Unbounded growth vectors exist (e.g., moduleKeys, platformLinks), but no direct chain-halting loop in critical write paths was identified.
- Escrow dispute liveness is the main practical DoS vector (fund freeze).
4.9 External Dependency Risk
- No findings requiring immediate remediation.
- @openzeppelin/contracts / @openzeppelin/contracts-upgradeable at ^5.2.0 are modern and appropriate.
- SafeERC20 usage is generally correct.
---
5. Gas Optimization Recommendations (>1,000 gas/call opportunities)
- ClawContracts.completeContract (ClawContracts.sol:442): track approvedMilestoneCount during approval to avoid full array scan; saves significant gas for multi-milestone contracts.
- ClawDAO._verifyEmergencySignatures (ClawDAO.sol:584): replace repeated O(n²) duplicate checks and repeated signer scans with mappings/bitmaps; substantial savings in emergency path.
- ClawEscrow._calculateFee (ClawEscrow.sol:372): currently performs 3 external registry reads per call; cache effective params per update epoch or batch-fetch once to reduce call overhead in hot paths.
- ClawRouter.batchRegisterModules (ClawRouter.sol:104): micro-optimize by caching arrays and unchecked increments in bounded loops.
---
6. Code Quality Observations
- Documentation quality is high overall, but key security assertions are out of sync with implementation ([I-02]).
- Event coverage is generally good and consistent across lifecycle transitions.
- Custom errors are used effectively and improve revert clarity.
- NatSpec coverage is good in core contracts; still uneven for some admin/internal assumptions and should be tightened for operational safety constraints.
---
7. Summary Table
| ID | Title | Severity | Contract | Status |
|----|-------|----------|----------|--------|
| C-01 | Governance vote inflation via transferable balances (no snapshot / no vote escrow) | Critical | ClawDAO | Open |
| H-01 | DID registration/rotation lacks cryptographic proof-of-ownership | High | ClawIdentity | Open |
| H-02 | Emergency path threshold weaker than stated trust model (5-of-9 vs required 9-of-9) | High | ClawDAO | Open |
| M-01 | Disputed escrows can be permanently locked if arbiter is unavailable | Medium | ClawEscrow | Open |
| M-02 | Escrow fee model can be bypassed via zero-fee top-ups | Medium | ClawEscrow | Open |
| M-03 | ClawRouter.multicall is an unrestricted arbitrary call forwarder (confused-deputy risk) | Medium | ClawRouter | Open |
| M-04 | Critical parameter updates lack safety bounds (can weaken governance or brick flows) | Medium | ClawDAO / ParamRegistry | Open |
| L-01 | Single-step admin trust transfer increases operational key-risk | Low | All contracts | Open |
| I-01 | Lockup multiplier path in DAO is currently non-functional | Informational | ClawDAO / ClawStaking | Open |
| I-02 | Security documentation and implementation diverge on critical assumptions | Informational | Docs + system-wide | Open |
---