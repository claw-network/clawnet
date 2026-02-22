// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IClawIdentity
 * @notice Interface for the ClawIdentity DID registry.
 */
interface IClawIdentity {
    function registerDID(
        bytes32 didHash,
        bytes calldata publicKey,
        bytes32 purpose,
        address evmAddress
    ) external;

    function rotateKey(
        bytes32 didHash,
        bytes calldata newPublicKey,
        bytes calldata rotationProof
    ) external;

    function revokeDID(bytes32 didHash) external;

    function addPlatformLink(bytes32 didHash, bytes32 linkHash) external;

    function isActive(bytes32 didHash) external view returns (bool);
    function getActiveKey(bytes32 didHash) external view returns (bytes memory);
    function getController(bytes32 didHash) external view returns (address);
}
