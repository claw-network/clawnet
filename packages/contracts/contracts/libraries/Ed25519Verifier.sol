// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title Ed25519Verifier
 * @notice Ed25519 signature helper library for ClawNet.
 * @dev Phase 1 implements the precompile adapter and fail-closed semantics while
 *      ClawIdentity continues to use controller ECDSA proof on its main path.
 *      Phase 2 on-chain Ed25519 verification is targeted at a Besu custom
 *      precompile backend at address 0x0100.
 *
 *      This library provides:
 *      - Domain-separated signing payloads for key rotation, DID registration, platform links
 *      - Structured hash builders that both Solidity and off-chain code use identically
 *      - A precompile address constant for Phase 2 integration
 *
 *      Off-chain verification MUST use the same payload construction to ensure consistency.
 *      See: packages/core/src/crypto/ and scripts/did-address.ts for TypeScript counterparts.
 */
library Ed25519Verifier {
    // ─── Constants ─────────────────────────────────────────────────

    /// @notice Reserved precompile address for future on-chain Ed25519 verification.
    address internal constant ED25519_PRECOMPILE = address(0x0100);

    /// @notice Domain separator prefix for all ClawNet Ed25519 signing payloads.
    bytes internal constant DOMAIN_PREFIX = "clawnet:";

    /// @notice Version tag appended to domain for upgradability.
    bytes internal constant VERSION_TAG = "v1";

    error InvalidSignatureLength();
    error Ed25519VerificationUnavailable();

    // ─── Payload Builders ──────────────────────────────────────────

    /**
     * @notice Compute the signing payload for DID key rotation.
     * @dev Off-chain: sign this payload with the OLD key to authorize the new key.
     *      Payload = keccak256("clawnet:rotate:v1:" || didHash || oldKeyHash || newKeyHash)
     * @param didHash     SHA-256 hash of the DID string.
     * @param oldKeyHash  keccak256 of the current (old) public key bytes.
     * @param newKeyHash  keccak256 of the new public key bytes.
     * @return payload    The 32-byte signing payload.
     */
    function rotationPayload(
        bytes32 didHash,
        bytes32 oldKeyHash,
        bytes32 newKeyHash
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(DOMAIN_PREFIX, "rotate:", VERSION_TAG, ":", didHash, oldKeyHash, newKeyHash)
        );
    }

    /**
     * @notice Compute the signing payload for DID registration.
     * @dev Off-chain: sign this payload with the Ed25519 key being registered.
     *      Payload = keccak256("clawnet:register:v1:" || didHash || controllerAddress)
     * @param didHash     SHA-256 hash of the DID string.
     * @param controller  The EVM address that will control this DID.
     * @return payload    The 32-byte signing payload.
     */
    function registrationPayload(
        bytes32 didHash,
        address controller
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(DOMAIN_PREFIX, "register:", VERSION_TAG, ":", didHash, controller)
        );
    }

    /**
     * @notice Compute the signing payload for platform link anchoring.
     * @dev Off-chain: sign this payload with the DID's active key.
     *      Payload = keccak256("clawnet:link:v1:" || didHash || linkHash)
     * @param didHash   SHA-256 hash of the DID string.
     * @param linkHash  keccak256 of the platform link proof data.
     * @return payload  The 32-byte signing payload.
     */
    function linkPayload(
        bytes32 didHash,
        bytes32 linkHash
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(DOMAIN_PREFIX, "link:", VERSION_TAG, ":", didHash, linkHash)
        );
    }

    /**
     * @notice Compute the signing payload for DID revocation.
     * @dev Off-chain: sign this payload with the DID's active key.
     *      Payload = keccak256("clawnet:revoke:v1:" || didHash || nonce)
     * @param didHash  SHA-256 hash of the DID string.
     * @param nonce    A unique nonce to prevent replay.
     * @return payload The 32-byte signing payload.
     */
    function revocationPayload(
        bytes32 didHash,
        uint256 nonce
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(DOMAIN_PREFIX, "revoke:", VERSION_TAG, ":", didHash, nonce)
        );
    }

    // ─── Phase 2: On-Chain Verification (Precompile) ────────────────

    /**
     * @notice Verify an Ed25519 signature on-chain via the configured verifier backend.
     * @dev Today this library only supports the reserved Ed25519 precompile path.
     *      If the chain does not expose that backend, this function reverts with
     *      Ed25519VerificationUnavailable() instead of silently returning false.
     *      That keeps accidental production usage fail-closed until a real verifier
     *      is wired in.
     * @param message   The 32-byte message hash to verify.
     * @param signature The 64-byte Ed25519 signature.
     * @param publicKey The 32-byte Ed25519 public key.
     * @return valid    True if the signature is valid.
     */
    function verify(
        bytes32 message,
        bytes calldata signature,
        bytes32 publicKey
    ) internal view returns (bool valid) {
        if (signature.length != 64) revert InvalidSignatureLength();

        // Encode: message (32) || signature (64) || publicKey (32) = 128 bytes
        bytes memory input = abi.encodePacked(message, signature, publicKey);

        // Static call to precompile
        (bool success, bytes memory output) = ED25519_PRECOMPILE.staticcall(input);

        if (!success || output.length < 32) {
            revert Ed25519VerificationUnavailable();
        }

        // Check first byte of output
        valid = uint8(output[31]) == 1;
    }
}
