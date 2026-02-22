// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ParamRegistry.sol";

/**
 * @title ClawDAO
 * @notice DAO governance — proposals, weighted voting, timelock, emergency multisig.
 * @dev UUPS upgradeable. Combines T-2.4 (core), T-2.5 (timelock), T-2.6 (emergency multisig).
 *
 *  Voting power formula:
 *    power = sqrt(tokenBalance) * (1 + trustScore/1000) * lockupMultiplier
 *
 *  Proposal lifecycle:
 *    Discussion -> Voting -> Passed/Rejected -> Timelocked -> Executed
 *    Emergency path: emergencyExecute (5/9 multisig) bypasses voting + timelock.
 */
contract ClawDAO is
    AccessControlUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ─── Roles ───────────────────────────────────────────────────────

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant CANCELLER_ROLE = keccak256("CANCELLER_ROLE");

    // ─── Enums ───────────────────────────────────────────────────────

    enum ProposalType {
        ParameterChange,
        TreasurySpend,
        ProtocolUpgrade,
        Emergency,
        Signal
    }

    enum ProposalStatus {
        Discussion,
        Voting,
        Passed,
        Rejected,
        Timelocked,
        Executed,
        Cancelled,
        Expired
    }

    // ─── Structs (split to avoid stack-too-deep) ─────────────────────

    struct ProposalCore {
        address        proposer;
        ProposalType   pType;
        ProposalStatus status;
        bytes32        descriptionHash;
        address        target;
        uint256        snapshotBlock;
    }

    struct ProposalTimeline {
        uint64 createdAt;
        uint64 discussionEndAt;
        uint64 votingEndAt;
        uint64 timelockEndAt;
    }

    struct ProposalVotes {
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
    }

    /// @notice Convenience struct returned by getProposal() view.
    struct ProposalView {
        uint256        id;
        address        proposer;
        ProposalType   pType;
        ProposalStatus status;
        bytes32        descriptionHash;
        address        target;
        uint256        snapshotBlock;
        uint64         createdAt;
        uint64         discussionEndAt;
        uint64         votingEndAt;
        uint64         timelockEndAt;
        uint256        forVotes;
        uint256        againstVotes;
        uint256        abstainVotes;
    }

    struct Receipt {
        bool    hasVoted;
        uint8   support;   // 0=Against, 1=For, 2=Abstain
        uint256 weight;
    }

    // ─── State ───────────────────────────────────────────────────────

    IERC20 public token;
    ParamRegistry public paramRegistry;
    address public reputationContract;
    address public stakingContract;

    uint256 public proposalCount;

    mapping(uint256 => ProposalCore)     internal _cores;
    mapping(uint256 => ProposalTimeline) internal _timelines;
    mapping(uint256 => ProposalVotes)    internal _votes;
    mapping(uint256 => bytes)            internal _callDatas;
    mapping(uint256 => mapping(address => Receipt)) public receipts;

    // Governance defaults
    uint256 public proposalThreshold;
    uint64  public discussionPeriod;
    uint64  public votingPeriod;
    uint64  public timelockDelay;
    uint256 public quorumBps;

    // Emergency MultiSig (T-2.6)
    address[9] public emergencySigners;
    uint8 public constant EMERGENCY_THRESHOLD = 5;

    // ─── Events ──────────────────────────────────────────────────────

    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, ProposalType pType, address target, bytes32 descriptionHash);
    event VoteCast(uint256 indexed proposalId, address indexed voter, uint8 support, uint256 weight);
    event ProposalAdvanced(uint256 indexed proposalId, ProposalStatus newStatus);
    event ProposalQueued(uint256 indexed proposalId, uint64 timelockEndAt);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);
    event EmergencyExecuted(uint256 indexed proposalId, address[] signers);
    event EmergencySignersUpdated(address[9] newSigners);

    // ─── Errors ──────────────────────────────────────────────────────

    error InvalidAddress();
    error InvalidParams();
    error InsufficientVotingPower(uint256 has, uint256 required);
    error InvalidProposalId(uint256 proposalId);
    error NotInStatus(ProposalStatus current, ProposalStatus expected);
    error AlreadyVoted(uint256 proposalId, address voter);
    error InvalidSupport(uint8 support);
    error TimelockNotElapsed(uint64 timelockEndAt, uint256 currentTime);
    error NotProposer(uint256 proposalId);
    error ProposalExpired(uint256 proposalId);
    error ExecutionFailed(uint256 proposalId);
    error InsufficientSignatures(uint256 provided, uint256 required);
    error InvalidSignature();
    error DuplicateSigner(address signer);
    error NotEmergencySigner(address signer);

    // ─── Initializer ─────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address tokenAddress,
        address paramRegistryAddr,
        uint256 proposalThreshold_,
        uint64  discussionPeriod_,
        uint64  votingPeriod_,
        uint64  timelockDelay_,
        uint256 quorumBps_,
        address[9] calldata signers
    ) public initializer {
        if (tokenAddress == address(0)) revert InvalidAddress();
        if (paramRegistryAddr == address(0)) revert InvalidAddress();
        if (votingPeriod_ == 0) revert InvalidParams();
        if (quorumBps_ == 0 || quorumBps_ > 10000) revert InvalidParams();

        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(CANCELLER_ROLE, msg.sender);

        token = IERC20(tokenAddress);
        paramRegistry = ParamRegistry(paramRegistryAddr);
        proposalThreshold = proposalThreshold_;
        discussionPeriod = discussionPeriod_;
        votingPeriod = votingPeriod_;
        timelockDelay = timelockDelay_;
        quorumBps = quorumBps_;

        _setEmergencySigners(signers);
    }

    // ─── Proposal Lifecycle ──────────────────────────────────────────

    function propose(
        ProposalType pType,
        bytes32 descriptionHash,
        address target,
        bytes calldata callData
    ) external whenNotPaused returns (uint256 proposalId) {
        uint256 threshold = _getProposalThreshold();
        uint256 balance = token.balanceOf(msg.sender);
        if (balance < threshold) revert InsufficientVotingPower(balance, threshold);

        proposalId = ++proposalCount;

        uint64 now_ = uint64(block.timestamp);
        uint64 dPeriod = _getDiscussionPeriod();
        uint64 vPeriod = _getVotingPeriod();

        _cores[proposalId] = ProposalCore({
            proposer: msg.sender,
            pType: pType,
            status: ProposalStatus.Discussion,
            descriptionHash: descriptionHash,
            target: target,
            snapshotBlock: block.number
        });

        _timelines[proposalId] = ProposalTimeline({
            createdAt: now_,
            discussionEndAt: now_ + dPeriod,
            votingEndAt: now_ + dPeriod + vPeriod,
            timelockEndAt: 0
        });

        // _votes defaults to zeros
        _callDatas[proposalId] = callData;

        emit ProposalCreated(proposalId, msg.sender, pType, target, descriptionHash);
    }

    function vote(uint256 proposalId, uint8 support) external whenNotPaused {
        _requireExists(proposalId);
        ProposalCore storage c = _cores[proposalId];
        ProposalTimeline storage t = _timelines[proposalId];
        uint64 now_ = uint64(block.timestamp);

        // Auto-advance Discussion -> Voting
        if (c.status == ProposalStatus.Discussion && now_ >= t.discussionEndAt) {
            c.status = ProposalStatus.Voting;
            emit ProposalAdvanced(proposalId, ProposalStatus.Voting);
        }

        if (c.status != ProposalStatus.Voting)
            revert NotInStatus(c.status, ProposalStatus.Voting);

        if (now_ > t.votingEndAt) {
            _finalizeVoting(proposalId);
            revert NotInStatus(c.status, ProposalStatus.Voting);
        }

        if (support > 2) revert InvalidSupport(support);

        Receipt storage r = receipts[proposalId][msg.sender];
        if (r.hasVoted) revert AlreadyVoted(proposalId, msg.sender);

        uint256 weight = getVotingPower(msg.sender);
        r.hasVoted = true;
        r.support = support;
        r.weight = weight;

        ProposalVotes storage v = _votes[proposalId];
        if (support == 0)      v.againstVotes += weight;
        else if (support == 1) v.forVotes += weight;
        else                   v.abstainVotes += weight;

        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    function queue(uint256 proposalId) external whenNotPaused {
        _requireExists(proposalId);
        ProposalCore storage c = _cores[proposalId];
        ProposalTimeline storage t = _timelines[proposalId];
        uint64 now_ = uint64(block.timestamp);

        // Auto-advance
        if (c.status == ProposalStatus.Discussion && now_ >= t.discussionEndAt) {
            c.status = ProposalStatus.Voting;
            emit ProposalAdvanced(proposalId, ProposalStatus.Voting);
        }
        if (c.status == ProposalStatus.Voting && now_ > t.votingEndAt) {
            _finalizeVoting(proposalId);
        }

        if (c.status != ProposalStatus.Passed)
            revert NotInStatus(c.status, ProposalStatus.Passed);

        if (c.pType == ProposalType.Signal) revert InvalidParams();

        uint64 delay = _getTimelockDelay();
        t.timelockEndAt = uint64(block.timestamp) + delay;
        c.status = ProposalStatus.Timelocked;

        emit ProposalQueued(proposalId, t.timelockEndAt);
        emit ProposalAdvanced(proposalId, ProposalStatus.Timelocked);
    }

    function execute(uint256 proposalId) external whenNotPaused nonReentrant {
        _requireExists(proposalId);
        ProposalCore storage c = _cores[proposalId];
        ProposalTimeline storage t = _timelines[proposalId];

        if (c.status != ProposalStatus.Timelocked)
            revert NotInStatus(c.status, ProposalStatus.Timelocked);

        if (uint64(block.timestamp) < t.timelockEndAt)
            revert TimelockNotElapsed(t.timelockEndAt, block.timestamp);

        // Expiry: 14 days after timelock ends
        if (uint64(block.timestamp) > t.timelockEndAt + 14 days) {
            c.status = ProposalStatus.Expired;
            emit ProposalAdvanced(proposalId, ProposalStatus.Expired);
            revert ProposalExpired(proposalId);
        }

        c.status = ProposalStatus.Executed;
        _executeCall(proposalId, c.target);

        emit ProposalExecuted(proposalId);
        emit ProposalAdvanced(proposalId, ProposalStatus.Executed);
    }

    function cancel(uint256 proposalId) external {
        _requireExists(proposalId);
        ProposalCore storage c = _cores[proposalId];

        if (
            c.status == ProposalStatus.Executed ||
            c.status == ProposalStatus.Cancelled ||
            c.status == ProposalStatus.Expired
        ) revert NotInStatus(c.status, ProposalStatus.Discussion);

        if (msg.sender != c.proposer && !hasRole(CANCELLER_ROLE, msg.sender))
            revert NotProposer(proposalId);

        c.status = ProposalStatus.Cancelled;
        emit ProposalCancelled(proposalId);
        emit ProposalAdvanced(proposalId, ProposalStatus.Cancelled);
    }

    // ─── Emergency MultiSig (T-2.6) ─────────────────────────────────

    function emergencyExecute(
        uint256 proposalId,
        address[] calldata signers_,
        bytes[] calldata signatures
    ) external nonReentrant {
        _requireExists(proposalId);
        ProposalCore storage c = _cores[proposalId];

        if (c.status == ProposalStatus.Executed || c.status == ProposalStatus.Cancelled)
            revert NotInStatus(c.status, ProposalStatus.Discussion);

        if (signers_.length < EMERGENCY_THRESHOLD || signatures.length < EMERGENCY_THRESHOLD)
            revert InsufficientSignatures(signers_.length, EMERGENCY_THRESHOLD);
        if (signers_.length != signatures.length) revert InvalidParams();

        _verifyEmergencySignatures(proposalId, signers_, signatures);

        c.status = ProposalStatus.Executed;
        _executeCall(proposalId, c.target);

        emit EmergencyExecuted(proposalId, signers_);
        emit ProposalAdvanced(proposalId, ProposalStatus.Executed);
    }

    // ─── Voting Power ────────────────────────────────────────────────

    function getVotingPower(address voter) public view returns (uint256 power) {
        uint256 balance = token.balanceOf(voter);
        if (balance == 0) return 0;

        uint256 sqrtBal = _sqrt(balance);
        uint256 trustMul = 1000 + _getTrustScore(voter);   // 1000 = 1x
        uint256 lockMul  = _getLockupMultiplier(voter);     // 1000 = 1x
        power = (sqrtBal * trustMul * lockMul) / 1_000_000;
    }

    // ─── View Functions ──────────────────────────────────────────────

    function getProposal(uint256 proposalId) external view returns (ProposalView memory pv) {
        _requireExists(proposalId);
        ProposalCore     storage c = _cores[proposalId];
        ProposalTimeline storage t = _timelines[proposalId];
        ProposalVotes    storage v = _votes[proposalId];
        pv = ProposalView({
            id: proposalId,
            proposer: c.proposer,
            pType: c.pType,
            status: c.status,
            descriptionHash: c.descriptionHash,
            target: c.target,
            snapshotBlock: c.snapshotBlock,
            createdAt: t.createdAt,
            discussionEndAt: t.discussionEndAt,
            votingEndAt: t.votingEndAt,
            timelockEndAt: t.timelockEndAt,
            forVotes: v.forVotes,
            againstVotes: v.againstVotes,
            abstainVotes: v.abstainVotes
        });
    }

    function getReceipt(uint256 proposalId, address voter) external view returns (Receipt memory) {
        return receipts[proposalId][voter];
    }

    function hasQuorum(uint256 proposalId) public view returns (bool) {
        ProposalVotes storage v = _votes[proposalId];
        uint256 totalVotes = v.forVotes + v.againstVotes + v.abstainVotes;
        uint256 supply = token.totalSupply();
        if (supply == 0) return false;
        return totalVotes * 10000 >= supply * _getQuorumBps();
    }

    function hasPassed(uint256 proposalId) public view returns (bool) {
        if (!hasQuorum(proposalId)) return false;
        return _votes[proposalId].forVotes > _votes[proposalId].againstVotes;
    }

    function getStatus(uint256 proposalId) external view returns (ProposalStatus) {
        _requireExists(proposalId);
        ProposalCore     storage c = _cores[proposalId];
        ProposalTimeline storage t = _timelines[proposalId];

        // Terminal states
        if (
            c.status == ProposalStatus.Executed ||
            c.status == ProposalStatus.Cancelled ||
            c.status == ProposalStatus.Expired ||
            c.status == ProposalStatus.Rejected
        ) return c.status;

        uint64 now_ = uint64(block.timestamp);

        if (c.status == ProposalStatus.Discussion && now_ >= t.discussionEndAt) {
            if (now_ > t.votingEndAt)
                return hasPassed(proposalId) ? ProposalStatus.Passed : ProposalStatus.Rejected;
            return ProposalStatus.Voting;
        }

        if (c.status == ProposalStatus.Voting && now_ > t.votingEndAt)
            return hasPassed(proposalId) ? ProposalStatus.Passed : ProposalStatus.Rejected;

        if (c.status == ProposalStatus.Timelocked && now_ > t.timelockEndAt + 14 days)
            return ProposalStatus.Expired;

        return c.status;
    }

    // ─── Admin ───────────────────────────────────────────────────────

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function setGovParams(
        uint256 proposalThreshold_,
        uint64  discussionPeriod_,
        uint64  votingPeriod_,
        uint64  timelockDelay_,
        uint256 quorumBps_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        proposalThreshold = proposalThreshold_;
        discussionPeriod = discussionPeriod_;
        votingPeriod = votingPeriod_;
        timelockDelay = timelockDelay_;
        quorumBps = quorumBps_;
    }

    function setReputationContract(address addr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        reputationContract = addr;
    }

    function setStakingContract(address addr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        stakingContract = addr;
    }

    function setEmergencySigners(address[9] calldata signers_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setEmergencySigners(signers_);
    }

    // ─── Internal: Param Getters ─────────────────────────────────────

    function _getProposalThreshold() internal view returns (uint256) {
        if (address(paramRegistry) != address(0))
            return paramRegistry.getParamWithDefault(paramRegistry.PROPOSAL_THRESHOLD(), proposalThreshold);
        return proposalThreshold;
    }

    function _getDiscussionPeriod() internal view returns (uint64) {
        return discussionPeriod;
    }

    function _getVotingPeriod() internal view returns (uint64) {
        if (address(paramRegistry) != address(0))
            return uint64(paramRegistry.getParamWithDefault(paramRegistry.VOTING_PERIOD(), uint256(votingPeriod)));
        return votingPeriod;
    }

    function _getTimelockDelay() internal view returns (uint64) {
        if (address(paramRegistry) != address(0))
            return uint64(paramRegistry.getParamWithDefault(paramRegistry.TIMELOCK_DELAY(), uint256(timelockDelay)));
        return timelockDelay;
    }

    function _getQuorumBps() internal view returns (uint256) {
        if (address(paramRegistry) != address(0))
            return paramRegistry.getParamWithDefault(paramRegistry.QUORUM_BPS(), quorumBps);
        return quorumBps;
    }

    // ─── Internal: Voting Helpers ────────────────────────────────────

    function _finalizeVoting(uint256 proposalId) internal {
        ProposalCore storage c = _cores[proposalId];
        if (hasPassed(proposalId)) {
            c.status = ProposalStatus.Passed;
            emit ProposalAdvanced(proposalId, ProposalStatus.Passed);
        } else {
            c.status = ProposalStatus.Rejected;
            emit ProposalAdvanced(proposalId, ProposalStatus.Rejected);
        }
    }

    function _getTrustScore(address voter) internal view returns (uint256) {
        if (reputationContract == address(0)) return 0;
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, bytes memory data) = reputationContract.staticcall(
            abi.encodeWithSignature("getTrustScore(address)", voter)
        );
        if (ok && data.length >= 32) {
            uint256 s = abi.decode(data, (uint256));
            return s > 1000 ? 1000 : s;
        }
        return 0;
    }

    function _getLockupMultiplier(address voter) internal view returns (uint256) {
        if (stakingContract == address(0)) return 1000;
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, bytes memory data) = stakingContract.staticcall(
            abi.encodeWithSignature("getLockupMultiplier(address)", voter)
        );
        if (ok && data.length >= 32) {
            uint256 m = abi.decode(data, (uint256));
            if (m < 1000) return 1000;
            return m > 3000 ? 3000 : m;
        }
        return 1000;
    }

    function _executeCall(uint256 proposalId, address target) internal {
        if (target == address(0)) return;
        bytes storage cd = _callDatas[proposalId];
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = target.call(cd);
        if (!success) revert ExecutionFailed(proposalId);
    }

    // ─── Internal: Emergency ─────────────────────────────────────────

    function _setEmergencySigners(address[9] calldata signers_) internal {
        for (uint256 i = 0; i < 9; i++) {
            if (signers_[i] == address(0)) revert InvalidAddress();
            for (uint256 j = 0; j < i; j++) {
                if (signers_[i] == signers_[j]) revert DuplicateSigner(signers_[i]);
            }
            emergencySigners[i] = signers_[i];
        }
        emit EmergencySignersUpdated(signers_);
    }

    function _verifyEmergencySignatures(
        uint256 proposalId,
        address[] calldata signers_,
        bytes[] calldata signatures
    ) internal view {
        bytes32 digest = keccak256(abi.encode(block.chainid, address(this), proposalId));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));

        uint256 valid = 0;
        address[] memory seen = new address[](signers_.length);

        for (uint256 i = 0; i < signers_.length && valid < EMERGENCY_THRESHOLD; i++) {
            address recovered = _recoverSigner(ethHash, signatures[i]);
            if (recovered != signers_[i]) revert InvalidSignature();
            if (!_isEmergencySigner(recovered)) revert NotEmergencySigner(recovered);
            for (uint256 j = 0; j < valid; j++) {
                if (seen[j] == recovered) revert DuplicateSigner(recovered);
            }
            seen[valid] = recovered;
            valid++;
        }

        if (valid < EMERGENCY_THRESHOLD)
            revert InsufficientSignatures(valid, EMERGENCY_THRESHOLD);
    }

    function _isEmergencySigner(address addr) internal view returns (bool) {
        for (uint256 i = 0; i < 9; i++) {
            if (emergencySigners[i] == addr) return true;
        }
        return false;
    }

    function _recoverSigner(bytes32 hash, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert InvalidSignature();
        bytes32 r; bytes32 s; uint8 v;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0)
            revert InvalidSignature();
        if (v != 27 && v != 28) revert InvalidSignature();
        address signer = ecrecover(hash, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
        return signer;
    }

    // ─── Internal: Math ──────────────────────────────────────────────

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = (x + 1) / 2;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    // ─── Internal: Helpers ───────────────────────────────────────────

    function _requireExists(uint256 proposalId) internal view {
        if (_timelines[proposalId].createdAt == 0) revert InvalidProposalId(proposalId);
    }

    // ─── Upgrade ─────────────────────────────────────────────────────

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {} // solhint-disable-line no-empty-blocks
}
