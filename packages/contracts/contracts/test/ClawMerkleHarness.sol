// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../libraries/ClawMerkle.sol";

/**
 * @dev Test harness that exposes ClawMerkle internal functions as external calls.
 */
contract ClawMerkleHarness {
    function verify(
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) external pure returns (bool) {
        return ClawMerkle.verify(proof, root, leaf);
    }

    function processProof(
        bytes32[] calldata proof,
        bytes32 leaf
    ) external pure returns (bytes32) {
        return ClawMerkle.processProof(proof, leaf);
    }

    function hashLeaf(bytes memory data) external pure returns (bytes32) {
        return ClawMerkle.hashLeaf(data);
    }

    function deliverableLeaf(
        bytes32 contractId,
        uint256 milestoneIndex,
        bytes32 contentHash
    ) external pure returns (bytes32) {
        return ClawMerkle.deliverableLeaf(contractId, milestoneIndex, contentHash);
    }

    function reviewLeaf(
        bytes32 reviewerId,
        bytes32 agentDIDHash,
        uint64 epoch,
        uint16 score,
        bytes32 commentHash
    ) external pure returns (bytes32) {
        return ClawMerkle.reviewLeaf(reviewerId, agentDIDHash, epoch, score, commentHash);
    }
}
