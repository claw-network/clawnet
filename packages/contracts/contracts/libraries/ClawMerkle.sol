// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title ClawMerkle
 * @notice Merkle tree utilities for reputation anchoring, deliverable verification,
 *         and general proof-of-inclusion across the ClawNet protocol.
 *
 *         Leaf values are double-hashed (keccak256(abi.encodePacked(keccak256(data))))
 *         to prevent second preimage attacks on internal tree nodes.
 */
library ClawMerkle {
    // ─── Core verification ───────────────────────────────────────────

    /**
     * @notice Verify a Merkle inclusion proof.
     * @param proof  Sibling hashes on the path from leaf to root.
     * @param root   Expected Merkle root.
     * @param leaf   Leaf hash to verify (should be produced by hashLeaf).
     * @return valid True if the proof is correct.
     */
    function verify(
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) internal pure returns (bool valid) {
        return MerkleProof.verifyCalldata(proof, root, leaf);
    }

    /**
     * @notice Reconstruct the Merkle root from a proof and leaf.
     *         Useful for building a root on-chain from known proofs.
     * @param proof  Sibling hashes on the path from leaf to root.
     * @param leaf   Leaf hash.
     * @return root  Computed Merkle root.
     */
    function processProof(
        bytes32[] calldata proof,
        bytes32 leaf
    ) internal pure returns (bytes32 root) {
        return MerkleProof.processProofCalldata(proof, leaf);
    }

    // ─── Leaf hashing ────────────────────────────────────────────────

    /**
     * @notice Double-hash arbitrary data into a leaf value.
     *         Mirrors the OpenZeppelin / merkletreejs "sorted pairs + double hash" standard.
     * @param data ABI-encoded leaf payload.
     */
    function hashLeaf(bytes memory data) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(keccak256(data)));
    }

    // ─── Domain-specific leaf builders ───────────────────────────────

    /**
     * @notice Compute a leaf for deliverable verification.
     * @param contractId     Service-contract identifier.
     * @param milestoneIndex Milestone index within the contract.
     * @param contentHash    Hash of the delivered content (e.g. IPFS CID hash).
     */
    function deliverableLeaf(
        bytes32 contractId,
        uint256 milestoneIndex,
        bytes32 contentHash
    ) internal pure returns (bytes32) {
        return hashLeaf(abi.encode(contractId, milestoneIndex, contentHash));
    }

    /**
     * @notice Compute a leaf for a reputation review entry.
     * @param reviewerId    Reviewer DID hash.
     * @param agentDIDHash  Reviewed agent DID hash.
     * @param epoch         Epoch number.
     * @param score         Review score (0-1000).
     * @param commentHash   Hash of review comment.
     */
    function reviewLeaf(
        bytes32 reviewerId,
        bytes32 agentDIDHash,
        uint64 epoch,
        uint16 score,
        bytes32 commentHash
    ) internal pure returns (bytes32) {
        return hashLeaf(abi.encode(reviewerId, agentDIDHash, epoch, score, commentHash));
    }
}
