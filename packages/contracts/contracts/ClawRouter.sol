// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title ClawRouter
 * @notice Module registry — stores addresses of all ClawNet contracts for
 *         unified lookup and optional multicall convenience.
 *
 *         Well-known module keys:
 *           TOKEN, ESCROW, IDENTITY, STAKING, DAO, CONTRACTS, REPUTATION, PARAM_REGISTRY
 *
 * @dev UUPS upgradeable. REGISTRAR_ROLE can register/update modules.
 */
contract ClawRouter is AccessControlUpgradeable, UUPSUpgradeable {
    // ─── Roles ───────────────────────────────────────────────────────

    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    // ─── Well-known module keys ──────────────────────────────────────

    bytes32 public constant MODULE_TOKEN          = keccak256("TOKEN");
    bytes32 public constant MODULE_ESCROW         = keccak256("ESCROW");
    bytes32 public constant MODULE_IDENTITY       = keccak256("IDENTITY");
    bytes32 public constant MODULE_STAKING        = keccak256("STAKING");
    bytes32 public constant MODULE_DAO            = keccak256("DAO");
    bytes32 public constant MODULE_CONTRACTS      = keccak256("CONTRACTS");
    bytes32 public constant MODULE_REPUTATION     = keccak256("REPUTATION");
    bytes32 public constant MODULE_PARAM_REGISTRY = keccak256("PARAM_REGISTRY");

    // ─── State ───────────────────────────────────────────────────────

    /// @notice moduleKey → contract address
    mapping(bytes32 => address) public modules;

    /// @notice Ordered list of registered module keys (for enumeration)
    bytes32[] public moduleKeys;

    /// @notice Whether a key has been registered before (for dedup in moduleKeys)
    mapping(bytes32 => bool) public keyRegistered;

    // ─── Events ──────────────────────────────────────────────────────

    event ModuleRegistered(bytes32 indexed key, address indexed addr);
    event ModuleUpdated(bytes32 indexed key, address indexed oldAddr, address indexed newAddr);

    // ─── Errors ──────────────────────────────────────────────────────

    error ZeroAddress();
    error ZeroKey();
    error ModuleNotFound(bytes32 key);
    error ArrayLengthMismatch();
    error EmptyBatch();
    error MulticallFailed(uint256 index, bytes returnData);

    // ─── Initializer ─────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
    }

    // ─── Module Registration ─────────────────────────────────────────

    /**
     * @notice Register or update a module address.
     * @param key  Module identifier (e.g. MODULE_TOKEN)
     * @param addr Contract address
     */
    function registerModule(
        bytes32 key,
        address addr
    ) external onlyRole(REGISTRAR_ROLE) {
        if (key == bytes32(0)) revert ZeroKey();
        if (addr == address(0)) revert ZeroAddress();

        address old = modules[key];
        modules[key] = addr;

        if (!keyRegistered[key]) {
            keyRegistered[key] = true;
            moduleKeys.push(key);
            emit ModuleRegistered(key, addr);
        } else {
            emit ModuleUpdated(key, old, addr);
        }
    }

    /**
     * @notice Batch-register multiple modules.
     * @param keys  Array of module keys
     * @param addrs Array of contract addresses (same length)
     */
    function batchRegisterModules(
        bytes32[] calldata keys,
        address[] calldata addrs
    ) external onlyRole(REGISTRAR_ROLE) {
        uint256 len = keys.length;
        if (len == 0) revert EmptyBatch();
        if (addrs.length != len) revert ArrayLengthMismatch();

        for (uint256 i; i < len; i++) {
            if (keys[i] == bytes32(0)) revert ZeroKey();
            if (addrs[i] == address(0)) revert ZeroAddress();

            address old = modules[keys[i]];
            modules[keys[i]] = addrs[i];

            if (!keyRegistered[keys[i]]) {
                keyRegistered[keys[i]] = true;
                moduleKeys.push(keys[i]);
                emit ModuleRegistered(keys[i], addrs[i]);
            } else {
                emit ModuleUpdated(keys[i], old, addrs[i]);
            }
        }
    }

    // ─── View: Queries ───────────────────────────────────────────────

    /**
     * @notice Get a module address; reverts if not registered.
     */
    function getModule(bytes32 key) external view returns (address) {
        address addr = modules[key];
        if (addr == address(0)) revert ModuleNotFound(key);
        return addr;
    }

    /**
     * @notice Get a module address; returns address(0) if not registered.
     */
    function getModuleOrZero(bytes32 key) external view returns (address) {
        return modules[key];
    }

    /**
     * @notice Return the count of registered module keys.
     */
    function moduleCount() external view returns (uint256) {
        return moduleKeys.length;
    }

    /**
     * @notice Return all registered module keys and addresses.
     */
    function getAllModules()
        external
        view
        returns (bytes32[] memory keys, address[] memory addrs)
    {
        uint256 len = moduleKeys.length;
        keys = new bytes32[](len);
        addrs = new address[](len);
        for (uint256 i; i < len; i++) {
            keys[i] = moduleKeys[i];
            addrs[i] = modules[moduleKeys[i]];
        }
    }

    // ─── Multicall ───────────────────────────────────────────────────

    /**
     * @notice Execute multiple calls to registered modules in a single tx.
     *         Useful for frontend batching (e.g. read multiple contract states).
     * @param targets Array of target contract addresses
     * @param data    Array of calldata for each call
     * @return results Array of return data from each call
     */
    function multicall(
        address[] calldata targets,
        bytes[] calldata data
    ) external returns (bytes[] memory results) {
        uint256 len = targets.length;
        if (len == 0) revert EmptyBatch();
        if (data.length != len) revert ArrayLengthMismatch();

        results = new bytes[](len);
        for (uint256 i; i < len; i++) {
            (bool success, bytes memory ret) = targets[i].call(data[i]);
            if (!success) revert MulticallFailed(i, ret);
            results[i] = ret;
        }
    }

    /**
     * @notice Static multicall — read-only batch queries.
     * @param targets Array of target contract addresses
     * @param data    Array of calldata for each call
     * @return results Array of return data from each call
     */
    function staticMulticall(
        address[] calldata targets,
        bytes[] calldata data
    ) external view returns (bytes[] memory results) {
        uint256 len = targets.length;
        if (len == 0) revert EmptyBatch();
        if (data.length != len) revert ArrayLengthMismatch();

        results = new bytes[](len);
        for (uint256 i; i < len; i++) {
            (bool success, bytes memory ret) = targets[i].staticcall(data[i]);
            if (!success) revert MulticallFailed(i, ret);
            results[i] = ret;
        }
    }

    // ─── Internal ────────────────────────────────────────────────────

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {} // solhint-disable-line no-empty-blocks
}
