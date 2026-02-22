// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title ClawReputation
 * @notice On-chain reputation anchoring — stores periodic snapshots and review Merkle roots.
 *         Off-chain computation, on-chain anchoring pattern.
 *
 *         Dimensions (5): transaction, fulfillment, quality, social, behavior
 *         Scores: 0–1000 (higher is better)
 *         Epoch: auto-incremented based on block.timestamp / epochDuration
 *
 * @dev UUPS upgradeable. Only ANCHOR_ROLE can write snapshots and reviews.
 *      ClawDAO reads getTrustScore(address) via staticcall for voting power.
 */
contract ClawReputation is
    AccessControlUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable
{
    // ─── Roles ───────────────────────────────────────────────────────

    bytes32 public constant ANCHOR_ROLE = keccak256("ANCHOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ─── Constants ───────────────────────────────────────────────────

    uint16 public constant MAX_SCORE = 1000;
    uint16 public constant DIMENSION_COUNT = 5;

    // ─── Structs ─────────────────────────────────────────────────────

    /**
     * @dev Reputation snapshot for an agent. Packed for storage efficiency.
     *      2 slots: slot1 = agentDIDHash, slot2 = 5×uint16 + uint16 + uint64 + uint64 = 30 bytes
     *      slot3 = merkleRoot
     */
    struct ReputationSnapshot {
        bytes32 agentDIDHash;
        uint16 overallScore;       // 0-1000
        uint16 transactionScore;   // dimension 0
        uint16 fulfillmentScore;   // dimension 1
        uint16 qualityScore;       // dimension 2
        uint16 socialScore;        // dimension 3
        uint16 behaviorScore;      // dimension 4
        uint64 epoch;
        uint64 timestamp;
        bytes32 merkleRoot;        // Merkle root of all reviews for this agent in this epoch
    }

    struct ReviewAnchor {
        bytes32 reviewerDIDHash;
        bytes32 subjectDIDHash;
        bytes32 txHash;            // associated service-contract tx hash
        uint64 timestamp;
        bool exists;
    }

    // ─── State ───────────────────────────────────────────────────────

    /// @notice agentDIDHash → latest snapshot
    mapping(bytes32 => ReputationSnapshot) public latestSnapshots;
    /// @notice agentDIDHash → epoch → historical snapshot
    mapping(bytes32 => mapping(uint64 => ReputationSnapshot)) public snapshotHistory;
    /// @notice reviewHash → ReviewAnchor
    mapping(bytes32 => ReviewAnchor) public reviewAnchors;

    /// @notice Maps EVM address → agentDIDHash (for ClawDAO compat via getTrustScore(address))
    mapping(address => bytes32) public addressToDID;

    /// @notice Epoch parameters
    uint64 public epochDuration; // default 86400 (24h)
    uint64 public epochStart;    // reference timestamp for epoch 0

    /// @notice Total anchored agents (for stats)
    uint256 public totalAgents;

    // ─── Events ──────────────────────────────────────────────────────

    event ReputationAnchored(
        bytes32 indexed agentDIDHash,
        uint64 indexed epoch,
        uint16 overallScore,
        bytes32 merkleRoot
    );
    event ReviewRecorded(
        bytes32 indexed reviewHash,
        bytes32 indexed subjectDIDHash,
        bytes32 reviewerDIDHash
    );
    event AddressDIDLinked(address indexed account, bytes32 indexed agentDIDHash);
    event EpochDurationUpdated(uint64 oldDuration, uint64 newDuration);

    // ─── Errors ──────────────────────────────────────────────────────

    error InvalidScore(uint16 score);
    error InvalidDIDHash();
    error ReviewAlreadyExists(bytes32 reviewHash);
    error ReviewNotFound(bytes32 reviewHash);
    error ArrayLengthMismatch();
    error EmptyBatch();
    error SnapshotNotFound(bytes32 agentDIDHash, uint64 epoch);
    error InvalidEpochDuration();

    // ─── Initializer ─────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @param admin         DEFAULT_ADMIN + ANCHOR_ROLE + PAUSER_ROLE
     * @param epochDuration_ Epoch duration in seconds (e.g. 86400 = 24h)
     */
    function initialize(
        address admin,
        uint64 epochDuration_
    ) public initializer {
        if (epochDuration_ == 0) revert InvalidEpochDuration();

        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ANCHOR_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);

        epochDuration = epochDuration_;
        epochStart = uint64(block.timestamp);
    }

    // ─── Core: Anchor Reputation ─────────────────────────────────────

    /**
     * @notice Anchor a reputation snapshot for a single agent.
     * @param agentDIDHash    keccak256 of the agent's DID string
     * @param overallScore    0-1000
     * @param dimensionScores [transaction, fulfillment, quality, social, behavior] each 0-1000
     * @param merkleRoot      Merkle root of all reviews contributing to this score
     */
    function anchorReputation(
        bytes32 agentDIDHash,
        uint16 overallScore,
        uint16[5] calldata dimensionScores,
        bytes32 merkleRoot
    ) external onlyRole(ANCHOR_ROLE) whenNotPaused {
        _anchorSingle(agentDIDHash, overallScore, dimensionScores, merkleRoot);
    }

    /**
     * @notice Batch-anchor reputations. Saves gas by amortizing tx overhead.
     *         dimensionScores is a flat array of length agentDIDHashes.length * 5.
     * @param agentDIDHashes Array of agent DID hashes
     * @param overallScores  Array of overall scores (same length)
     * @param dimensionScoresFlat Flat array: [agent0_d0..d4, agent1_d0..d4, ...]
     * @param merkleRoots    Array of merkle roots (same length)
     */
    function batchAnchorReputation(
        bytes32[] calldata agentDIDHashes,
        uint16[] calldata overallScores,
        uint16[] calldata dimensionScoresFlat,
        bytes32[] calldata merkleRoots
    ) external onlyRole(ANCHOR_ROLE) whenNotPaused {
        uint256 len = agentDIDHashes.length;
        if (len == 0) revert EmptyBatch();
        if (
            overallScores.length != len ||
            merkleRoots.length != len ||
            dimensionScoresFlat.length != len * DIMENSION_COUNT
        ) {
            revert ArrayLengthMismatch();
        }

        for (uint256 i; i < len; i++) {
            uint16[5] memory dims;
            uint256 offset = i * DIMENSION_COUNT;
            dims[0] = dimensionScoresFlat[offset];
            dims[1] = dimensionScoresFlat[offset + 1];
            dims[2] = dimensionScoresFlat[offset + 2];
            dims[3] = dimensionScoresFlat[offset + 3];
            dims[4] = dimensionScoresFlat[offset + 4];

            _anchorSingle(
                agentDIDHashes[i],
                overallScores[i],
                dims,
                merkleRoots[i]
            );
        }
    }

    // ─── Core: Record Review ─────────────────────────────────────────

    /**
     * @notice Record a review anchor on-chain (hash of full review stored off-chain).
     * @param reviewHash      keccak256 of the review content
     * @param reviewerDIDHash keccak256 of reviewer's DID
     * @param subjectDIDHash  keccak256 of the subject's DID
     * @param txHash          Associated service-contract transaction hash
     */
    function recordReview(
        bytes32 reviewHash,
        bytes32 reviewerDIDHash,
        bytes32 subjectDIDHash,
        bytes32 txHash
    ) external onlyRole(ANCHOR_ROLE) whenNotPaused {
        if (reviewHash == bytes32(0)) revert InvalidDIDHash();
        if (subjectDIDHash == bytes32(0)) revert InvalidDIDHash();
        if (reviewAnchors[reviewHash].exists) {
            revert ReviewAlreadyExists(reviewHash);
        }

        reviewAnchors[reviewHash] = ReviewAnchor({
            reviewerDIDHash: reviewerDIDHash,
            subjectDIDHash: subjectDIDHash,
            txHash: txHash,
            timestamp: uint64(block.timestamp),
            exists: true
        });

        emit ReviewRecorded(reviewHash, subjectDIDHash, reviewerDIDHash);
    }

    // ─── Core: Address ↔ DID Linking ─────────────────────────────────

    /**
     * @notice Link an EVM address to an agent DID hash.
     *         Enables ClawDAO to call getTrustScore(address).
     */
    function linkAddressToDID(
        address account,
        bytes32 agentDIDHash
    ) external onlyRole(ANCHOR_ROLE) whenNotPaused {
        if (account == address(0)) revert InvalidDIDHash();
        if (agentDIDHash == bytes32(0)) revert InvalidDIDHash();

        addressToDID[account] = agentDIDHash;

        emit AddressDIDLinked(account, agentDIDHash);
    }

    // ─── View: Queries ───────────────────────────────────────────────

    /**
     * @notice Get the latest reputation for an agent.
     * @return score The overall score (0-1000)
     * @return epoch The epoch at which this score was last anchored
     */
    function getReputation(
        bytes32 agentDIDHash
    ) external view returns (uint16 score, uint64 epoch) {
        ReputationSnapshot storage s = latestSnapshots[agentDIDHash];
        return (s.overallScore, s.epoch);
    }

    /**
     * @notice Get a full historical snapshot.
     */
    function getSnapshotHistory(
        bytes32 agentDIDHash,
        uint64 epoch
    ) external view returns (ReputationSnapshot memory) {
        ReputationSnapshot storage s = snapshotHistory[agentDIDHash][epoch];
        if (s.agentDIDHash == bytes32(0)) {
            revert SnapshotNotFound(agentDIDHash, epoch);
        }
        return s;
    }

    /**
     * @notice Get the full latest snapshot for an agent.
     */
    function getLatestSnapshot(
        bytes32 agentDIDHash
    ) external view returns (ReputationSnapshot memory) {
        return latestSnapshots[agentDIDHash];
    }

    /**
     * @notice Verify a recorded review exists and return its anchor data.
     */
    function verifyReview(
        bytes32 reviewHash
    ) external view returns (ReviewAnchor memory) {
        if (!reviewAnchors[reviewHash].exists) {
            revert ReviewNotFound(reviewHash);
        }
        return reviewAnchors[reviewHash];
    }

    /**
     * @notice Verify that a leaf belongs to an agent's reputation Merkle tree.
     * @param agentDIDHash Agent whose Merkle root to check against
     * @param epoch        Epoch of the snapshot containing the Merkle root
     * @param leaf         The leaf hash (e.g. keccak256 of review data)
     * @param proof        The Merkle proof
     * @return valid       Whether the proof verifies
     */
    function verifyMerkleProof(
        bytes32 agentDIDHash,
        uint64 epoch,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external view returns (bool valid) {
        ReputationSnapshot storage s = snapshotHistory[agentDIDHash][epoch];
        if (s.agentDIDHash == bytes32(0)) return false;
        return MerkleProof.verify(proof, s.merkleRoot, leaf);
    }

    /**
     * @notice Get the trust score for an EVM address.
     *         Called by ClawDAO via staticcall for voting power calculation.
     *         Returns the overall reputation score (0-1000), or 0 if not linked.
     */
    function getTrustScore(
        address account
    ) external view returns (uint256) {
        bytes32 didHash = addressToDID[account];
        if (didHash == bytes32(0)) return 0;
        return uint256(latestSnapshots[didHash].overallScore);
    }

    /**
     * @notice Get the current epoch number.
     */
    function getCurrentEpoch() public view returns (uint64) {
        return uint64((block.timestamp - epochStart) / epochDuration);
    }

    // ─── Admin ───────────────────────────────────────────────────────

    /**
     * @notice Update epoch duration. Only admin.
     * @param newDuration New epoch duration in seconds (must be > 0)
     */
    function setEpochDuration(
        uint64 newDuration
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newDuration == 0) revert InvalidEpochDuration();
        uint64 oldDuration = epochDuration;
        epochDuration = newDuration;
        emit EpochDurationUpdated(oldDuration, newDuration);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ─── Internal ────────────────────────────────────────────────────

    function _anchorSingle(
        bytes32 agentDIDHash,
        uint16 overallScore,
        uint16[5] memory dimensionScores,
        bytes32 merkleRoot
    ) internal {
        if (agentDIDHash == bytes32(0)) revert InvalidDIDHash();
        if (overallScore > MAX_SCORE) revert InvalidScore(overallScore);
        for (uint256 d; d < DIMENSION_COUNT; d++) {
            if (dimensionScores[d] > MAX_SCORE) {
                revert InvalidScore(dimensionScores[d]);
            }
        }

        uint64 epoch = getCurrentEpoch();

        // Track new agents
        if (latestSnapshots[agentDIDHash].agentDIDHash == bytes32(0)) {
            totalAgents++;
        }

        ReputationSnapshot memory snap = ReputationSnapshot({
            agentDIDHash: agentDIDHash,
            overallScore: overallScore,
            transactionScore: dimensionScores[0],
            fulfillmentScore: dimensionScores[1],
            qualityScore: dimensionScores[2],
            socialScore: dimensionScores[3],
            behaviorScore: dimensionScores[4],
            epoch: epoch,
            timestamp: uint64(block.timestamp),
            merkleRoot: merkleRoot
        });

        latestSnapshots[agentDIDHash] = snap;
        snapshotHistory[agentDIDHash][epoch] = snap;

        emit ReputationAnchored(agentDIDHash, epoch, overallScore, merkleRoot);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {} // solhint-disable-line no-empty-blocks
}
