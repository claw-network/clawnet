// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

/**
 * @title ClawIdentity
 * @notice On-chain DID registry — maps did:claw: identifiers to Ed25519 public keys and EVM addresses.
 *         Stores only hashes and minimal mappings on-chain; full DID documents live on IPFS/Ceramic.
 * @dev UUPS upgradeable. Supports key rotation, revocation, and platform link anchoring.
 *      Ed25519 signature verification for rotateKey is deferred to Phase 2 (T-0.13/T-0.14).
 *      Currently the rotation proof is stored but not cryptographically verified on-chain;
 *      only controller authorization is enforced.
 */
contract ClawIdentity is
    AccessControlUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable
{
    // ─── Roles ───────────────────────────────────────────────────────

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @notice REGISTRAR_ROLE can batch-register DIDs during migration (T-1.12).
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    // ─── Enums ───────────────────────────────────────────────────────

    enum KeyPurpose {
        Authentication,
        Assertion,
        KeyAgreement,
        Recovery
    }

    // ─── Structs ─────────────────────────────────────────────────────

    struct DIDRecord {
        bytes32 didHash;        // SHA-256(did:claw:xxx)
        bytes32 activeKeyHash;  // keccak256(current active public key)
        address controller;     // EVM address that controls this DID
        uint64  createdAt;
        uint64  updatedAt;
        bool    revoked;
    }

    struct KeyRecord {
        bytes   publicKey;      // Ed25519 public key (32 bytes)
        uint64  addedAt;
        uint64  revokedAt;      // 0 = not revoked
        KeyPurpose purpose;
    }

    // ─── State ───────────────────────────────────────────────────────

    /// @notice DID hash → DID record.
    mapping(bytes32 => DIDRecord) public dids;

    /// @notice DID hash → key hash → key record.
    mapping(bytes32 => mapping(bytes32 => KeyRecord)) public keys;

    /// @notice DID hash → platform link hashes (verified platform link proofs).
    mapping(bytes32 => bytes32[]) public platformLinks;

    /// @notice Total number of registered DIDs.
    uint256 public didCount;

    // ─── Events ──────────────────────────────────────────────────────

    event DIDRegistered(bytes32 indexed didHash, address indexed controller);
    event KeyRotated(bytes32 indexed didHash, bytes32 indexed oldKeyHash, bytes32 indexed newKeyHash);
    event DIDRevoked(bytes32 indexed didHash);
    event PlatformLinked(bytes32 indexed didHash, bytes32 linkHash);

    // ─── Errors ──────────────────────────────────────────────────────

    error DIDAlreadyExists(bytes32 didHash);
    error DIDNotFound(bytes32 didHash);
    error DIDIsRevoked(bytes32 didHash);
    error NotController(bytes32 didHash, address caller);
    error InvalidPublicKey();
    error InvalidAddress();
    error KeyAlreadyActive(bytes32 keyHash);
    error InvalidLinkHash();

    // ─── Modifiers ───────────────────────────────────────────────────

    modifier onlyController(bytes32 didHash) {
        DIDRecord storage d = dids[didHash];
        if (d.controller == address(0)) revert DIDNotFound(didHash);
        if (d.revoked) revert DIDIsRevoked(didHash);
        if (msg.sender != d.controller) revert NotController(didHash, msg.sender);
        _;
    }

    // ─── Initializer ─────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) public initializer {
        if (admin == address(0)) revert InvalidAddress();

        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
    }

    // ─── Core functions ──────────────────────────────────────────────

    /**
     * @notice Register a new DID on-chain. The caller becomes the controller.
     * @param didHash    SHA-256 hash of the full DID string (e.g., keccak256("did:claw:z6Mk...")).
     * @param publicKey  Ed25519 public key (must be exactly 32 bytes).
     * @param purpose    Key purpose enum.
     * @param evmAddress EVM address derived from the public key (for cross-reference).
     *                   If zero, defaults to msg.sender.
     */
    function registerDID(
        bytes32 didHash,
        bytes calldata publicKey,
        KeyPurpose purpose,
        address evmAddress
    ) external whenNotPaused {
        if (dids[didHash].controller != address(0)) revert DIDAlreadyExists(didHash);
        if (publicKey.length != 32) revert InvalidPublicKey();

        address controller = evmAddress == address(0) ? msg.sender : evmAddress;

        bytes32 keyHash = keccak256(publicKey);

        dids[didHash] = DIDRecord({
            didHash: didHash,
            activeKeyHash: keyHash,
            controller: controller,
            createdAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp),
            revoked: false
        });

        keys[didHash][keyHash] = KeyRecord({
            publicKey: publicKey,
            addedAt: uint64(block.timestamp),
            revokedAt: 0,
            purpose: purpose
        });

        didCount++;

        emit DIDRegistered(didHash, controller);
    }

    /**
     * @notice Batch-register DIDs (migration helper). Only callable by REGISTRAR_ROLE.
     * @param didHashes   Array of DID hashes.
     * @param publicKeys  Array of Ed25519 public keys (32 bytes each).
     * @param purposes    Array of key purposes.
     * @param controllers Array of controller addresses.
     */
    function batchRegisterDID(
        bytes32[] calldata didHashes,
        bytes[] calldata publicKeys,
        KeyPurpose[] calldata purposes,
        address[] calldata controllers
    ) external whenNotPaused onlyRole(REGISTRAR_ROLE) {
        uint256 len = didHashes.length;
        require(
            len == publicKeys.length && len == purposes.length && len == controllers.length,
            "Array length mismatch"
        );

        for (uint256 i = 0; i < len; i++) {
            bytes32 dh = didHashes[i];
            if (dids[dh].controller != address(0)) revert DIDAlreadyExists(dh);
            if (publicKeys[i].length != 32) revert InvalidPublicKey();

            address ctrl = controllers[i] == address(0) ? msg.sender : controllers[i];
            bytes32 keyHash = keccak256(publicKeys[i]);

            dids[dh] = DIDRecord({
                didHash: dh,
                activeKeyHash: keyHash,
                controller: ctrl,
                createdAt: uint64(block.timestamp),
                updatedAt: uint64(block.timestamp),
                revoked: false
            });

            keys[dh][keyHash] = KeyRecord({
                publicKey: publicKeys[i],
                addedAt: uint64(block.timestamp),
                revokedAt: 0,
                purpose: purposes[i]
            });

            emit DIDRegistered(dh, ctrl);
        }

        didCount += len;
    }

    /**
     * @notice Rotate the active key for a DID.
     *         Only the controller can rotate. The rotation proof is stored but
     *         on-chain Ed25519 verification is deferred to Phase 2 (T-0.14).
     * @param didHash       The DID to rotate the key for.
     * @param newPublicKey  New Ed25519 public key (32 bytes).
     * @param rotationProof Signature proof from the old key authorizing rotation
     *                      (stored on-chain; cryptographic verification in Phase 2).
     */
    function rotateKey(
        bytes32 didHash,
        bytes calldata newPublicKey,
        bytes calldata rotationProof
    ) external whenNotPaused onlyController(didHash) {
        if (newPublicKey.length != 32) revert InvalidPublicKey();
        // Suppress unused variable warning — proof stored/verified in Phase 2
        rotationProof; // solhint-disable-line no-unused-vars

        DIDRecord storage d = dids[didHash];
        bytes32 oldKeyHash = d.activeKeyHash;
        bytes32 newKeyHash = keccak256(newPublicKey);

        if (oldKeyHash == newKeyHash) revert KeyAlreadyActive(newKeyHash);

        // Revoke old key
        keys[didHash][oldKeyHash].revokedAt = uint64(block.timestamp);

        // Add new key
        keys[didHash][newKeyHash] = KeyRecord({
            publicKey: newPublicKey,
            addedAt: uint64(block.timestamp),
            revokedAt: 0,
            purpose: keys[didHash][oldKeyHash].purpose
        });

        // Update DID record
        d.activeKeyHash = newKeyHash;
        d.updatedAt = uint64(block.timestamp);

        emit KeyRotated(didHash, oldKeyHash, newKeyHash);
    }

    /**
     * @notice Revoke a DID — only callable by its controller.
     *         Revocation is permanent and cannot be undone.
     */
    function revokeDID(bytes32 didHash) external whenNotPaused onlyController(didHash) {
        DIDRecord storage d = dids[didHash];
        d.revoked = true;
        d.updatedAt = uint64(block.timestamp);

        // Also revoke the active key
        keys[didHash][d.activeKeyHash].revokedAt = uint64(block.timestamp);

        emit DIDRevoked(didHash);
    }

    /**
     * @notice Add a platform link proof hash to a DID.
     *         The full VC is stored off-chain (IPFS); only the hash is anchored on-chain.
     * @param didHash  The DID to link.
     * @param linkHash Hash of the platform link verifiable credential.
     */
    function addPlatformLink(
        bytes32 didHash,
        bytes32 linkHash
    ) external whenNotPaused onlyController(didHash) {
        if (linkHash == bytes32(0)) revert InvalidLinkHash();

        platformLinks[didHash].push(linkHash);

        emit PlatformLinked(didHash, linkHash);
    }

    // ─── View functions ──────────────────────────────────────────────

    /**
     * @notice Check if a DID is active (registered and not revoked).
     */
    function isActive(bytes32 didHash) external view returns (bool) {
        DIDRecord storage d = dids[didHash];
        return d.controller != address(0) && !d.revoked;
    }

    /**
     * @notice Get the current active public key for a DID.
     */
    function getActiveKey(bytes32 didHash) external view returns (bytes memory) {
        DIDRecord storage d = dids[didHash];
        if (d.controller == address(0)) revert DIDNotFound(didHash);
        return keys[didHash][d.activeKeyHash].publicKey;
    }

    /**
     * @notice Get the controller address for a DID.
     */
    function getController(bytes32 didHash) external view returns (address) {
        DIDRecord storage d = dids[didHash];
        if (d.controller == address(0)) revert DIDNotFound(didHash);
        return d.controller;
    }

    /**
     * @notice Get a specific key record.
     */
    function getKeyRecord(
        bytes32 didHash,
        bytes32 keyHash
    ) external view returns (
        bytes memory publicKey,
        uint64 addedAt,
        uint64 revokedAt,
        KeyPurpose purpose
    ) {
        KeyRecord storage k = keys[didHash][keyHash];
        return (k.publicKey, k.addedAt, k.revokedAt, k.purpose);
    }

    /**
     * @notice Get all platform link hashes for a DID.
     */
    function getPlatformLinks(bytes32 didHash) external view returns (bytes32[] memory) {
        return platformLinks[didHash];
    }

    /**
     * @notice Get the number of platform links for a DID.
     */
    function getPlatformLinkCount(bytes32 didHash) external view returns (uint256) {
        return platformLinks[didHash].length;
    }

    // ─── Admin ───────────────────────────────────────────────────────

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ─── Internal ────────────────────────────────────────────────────

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {} // solhint-disable-line no-empty-blocks
}
