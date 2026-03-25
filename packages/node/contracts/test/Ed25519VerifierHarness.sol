// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../libraries/Ed25519Verifier.sol";

/**
 * @title Ed25519VerifierHarness
 * @notice Test harness that exposes Ed25519Verifier internal functions as external.
 */
contract Ed25519VerifierHarness {
    function rotationPayload(
        bytes32 didHash,
        bytes32 oldKeyHash,
        bytes32 newKeyHash
    ) external pure returns (bytes32) {
        return Ed25519Verifier.rotationPayload(didHash, oldKeyHash, newKeyHash);
    }

    function registrationPayload(
        bytes32 didHash,
        address controller
    ) external pure returns (bytes32) {
        return Ed25519Verifier.registrationPayload(didHash, controller);
    }

    function linkPayload(
        bytes32 didHash,
        bytes32 linkHash
    ) external pure returns (bytes32) {
        return Ed25519Verifier.linkPayload(didHash, linkHash);
    }

    function revocationPayload(
        bytes32 didHash,
        uint256 nonce
    ) external pure returns (bytes32) {
        return Ed25519Verifier.revocationPayload(didHash, nonce);
    }

    function verify(
        bytes32 message,
        bytes calldata signature,
        bytes32 publicKey
    ) external view returns (bool) {
        return Ed25519Verifier.verify(message, signature, publicKey);
    }
}
