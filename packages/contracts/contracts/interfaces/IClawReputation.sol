// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IClawReputation
 * @notice Interface for the ClawReputation contract.
 */
interface IClawReputation {
    function anchorReputation(
        bytes32 agentDIDHash,
        uint256 overallScore,
        uint256[5] calldata dimensionScores,
        bytes32 merkleRoot
    ) external;

    function batchAnchorReputation(
        bytes32[] calldata agentDIDHashes,
        uint256[] calldata scores,
        bytes32[] calldata merkleRoots
    ) external;

    function recordReview(
        bytes32 reviewHash,
        bytes32 reviewerDIDHash,
        bytes32 subjectDIDHash,
        bytes32 txHash
    ) external;

    function getReputation(bytes32 agentDIDHash) external view returns (uint256 score, uint256 epoch);
}
