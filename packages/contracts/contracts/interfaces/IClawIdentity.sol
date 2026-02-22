// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IClawIdentity
 * @notice Interface for the ClawIdentity DID registry.
 */
interface IClawIdentity {
    // ─── Enums ───────────────────────────────────────────────────────

    enum KeyPurpose {
        Authentication,
        Assertion,
        KeyAgreement,
        Recovery
    }

    // ─── Events ──────────────────────────────────────────────────────

    event DIDRegistered(bytes32 indexed didHash, address indexed controller);
    event KeyRotated(bytes32 indexed didHash, bytes32 indexed oldKeyHash, bytes32 indexed newKeyHash);
    event DIDRevoked(bytes32 indexed didHash);
    event PlatformLinked(bytes32 indexed didHash, bytes32 linkHash);

    // ─── Core functions ──────────────────────────────────────────────

    function registerDID(
        bytes32 didHash,
        bytes calldata publicKey,
        KeyPurpose purpose,
        address evmAddress
    ) external;

    function batchRegisterDID(
        bytes32[] calldata didHashes,
        bytes[] calldata publicKeys,
        KeyPurpose[] calldata purposes,
        address[] calldata controllers
    ) external;

    function rotateKey(
        bytes32 didHash,
        bytes calldata newPublicKey,
        bytes calldata rotationProof
    ) external;

    function revokeDID(bytes32 didHash) external;

    function addPlatformLink(bytes32 didHash, bytes32 linkHash) external;

    // ─── View functions ──────────────────────────────────────────────

    function isActive(bytes32 didHash) external view returns (bool);
    function getActiveKey(bytes32 didHash) external view returns (bytes memory);
    function getController(bytes32 didHash) external view returns (address);
    function getKeyRecord(bytes32 didHash, bytes32 keyHash) external view returns (
        bytes memory publicKey,
        uint64 addedAt,
        uint64 revokedAt,
        KeyPurpose purpose
    );
    function getPlatformLinks(bytes32 didHash) external view returns (bytes32[] memory);
    function getPlatformLinkCount(bytes32 didHash) external view returns (uint256);
}
