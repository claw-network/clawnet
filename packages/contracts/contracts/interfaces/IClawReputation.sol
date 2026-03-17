// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IClawReputation
 * @notice Interface for the ClawReputation contract.
 */
interface IClawReputation {
    // ─── Structs ─────────────────────────────────────────────────────
    struct ReputationSnapshot {
        bytes32 agentDIDHash;
        uint16 overallScore;
        uint16 transactionScore;
        uint16 fulfillmentScore;
        uint16 qualityScore;
        uint16 socialScore;
        uint16 behaviorScore;
        uint64 epoch;
        uint64 timestamp;
        bytes32 merkleRoot;
    }

    struct ReviewAnchor {
        bytes32 reviewerDIDHash;
        bytes32 subjectDIDHash;
        bytes32 txHash;
        uint64 timestamp;
        bool exists;
    }

    // ─── Write ───────────────────────────────────────────────────────
    function anchorReputation(
        bytes32 agentDIDHash,
        uint16 overallScore,
        uint16[5] calldata dimensionScores,
        bytes32 merkleRoot
    ) external;

    function batchAnchorReputation(
        bytes32[] calldata agentDIDHashes,
        uint16[] calldata overallScores,
        uint16[] calldata dimensionScoresFlat,
        bytes32[] calldata merkleRoots
    ) external;

    function recordReview(
        bytes32 reviewHash,
        bytes32 reviewerDIDHash,
        bytes32 subjectDIDHash,
        bytes32 txHash
    ) external;

    function linkAddressToDID(address account, bytes32 agentDIDHash) external;

    // ─── Read ────────────────────────────────────────────────────────
    function getReputation(bytes32 agentDIDHash) external view returns (uint16 score, uint64 epoch);
    function getSnapshotHistory(bytes32 agentDIDHash, uint64 epoch) external view returns (ReputationSnapshot memory);
    function getLatestSnapshot(bytes32 agentDIDHash) external view returns (ReputationSnapshot memory);
    function verifyReview(bytes32 reviewHash) external view returns (ReviewAnchor memory);
    function verifyMerkleProof(bytes32 agentDIDHash, uint64 epoch, bytes32 leaf, bytes32[] calldata proof) external view returns (bool);
    function getTrustScore(address account) external view returns (uint256);
    function getCurrentEpoch() external view returns (uint64);
}
