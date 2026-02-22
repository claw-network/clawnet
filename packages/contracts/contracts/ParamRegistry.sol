// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title ParamRegistry
 * @notice Governable parameter store — key/value uint256 pairs controlled by ClawDAO.
 * @dev UUPS upgradeable. GOVERNOR_ROLE is granted to ClawDAO upon deployment.
 *      All governable protocol parameters (fee rates, stake minimums, voting thresholds, etc.)
 *      are stored here and read by other contracts via `getParam` / `getParamWithDefault`.
 *
 *      Parameter keys are bytes32 constants defined below. Values are uint256.
 *      A value of 0 means "not set" for getParam — use getParamWithDefault for fallback.
 */
contract ParamRegistry is AccessControlUpgradeable, UUPSUpgradeable {
    // ─── Roles ───────────────────────────────────────────────────────

    /// @notice Only addresses with GOVERNOR_ROLE can set parameters.
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    // ─── Parameter Key Constants ─────────────────────────────────────

    // Market fees
    bytes32 public constant MARKET_FEE_INFO = keccak256("MARKET_FEE_INFO");
    bytes32 public constant MARKET_FEE_TASK = keccak256("MARKET_FEE_TASK");
    bytes32 public constant MARKET_FEE_CAP = keccak256("MARKET_FEE_CAP");
    bytes32 public constant MARKET_MIN_FEE = keccak256("MARKET_MIN_FEE");
    bytes32 public constant MARKET_MAX_FEE = keccak256("MARKET_MAX_FEE");

    // Escrow
    bytes32 public constant ESCROW_BASE_RATE = keccak256("ESCROW_BASE_RATE");
    bytes32 public constant ESCROW_HOLDING_RATE = keccak256("ESCROW_HOLDING_RATE");
    bytes32 public constant ESCROW_MIN_FEE = keccak256("ESCROW_MIN_FEE");

    // Transfer
    bytes32 public constant MIN_TRANSFER_AMOUNT = keccak256("MIN_TRANSFER_AMOUNT");
    bytes32 public constant MIN_ESCROW_AMOUNT = keccak256("MIN_ESCROW_AMOUNT");

    // Staking
    bytes32 public constant MIN_NODE_STAKE = keccak256("MIN_NODE_STAKE");
    bytes32 public constant UNSTAKE_COOLDOWN = keccak256("UNSTAKE_COOLDOWN");
    bytes32 public constant VALIDATOR_REWARD_RATE = keccak256("VALIDATOR_REWARD_RATE");
    bytes32 public constant SLASH_PER_VIOLATION = keccak256("SLASH_PER_VIOLATION");

    // Reputation
    bytes32 public constant TRUST_DECAY_RATE = keccak256("TRUST_DECAY_RATE");
    bytes32 public constant EPOCH_DURATION = keccak256("EPOCH_DURATION");

    // DAO governance
    bytes32 public constant PROPOSAL_THRESHOLD = keccak256("PROPOSAL_THRESHOLD");
    bytes32 public constant VOTING_PERIOD = keccak256("VOTING_PERIOD");
    bytes32 public constant TIMELOCK_DELAY = keccak256("TIMELOCK_DELAY");
    bytes32 public constant QUORUM_BPS = keccak256("QUORUM_BPS");

    // ─── State ───────────────────────────────────────────────────────

    /// @notice key → value mapping for all protocol parameters.
    mapping(bytes32 => uint256) private _params;

    /// @notice Ordered list of all keys that have been set (for enumeration).
    bytes32[] private _keys;

    /// @notice Tracks whether a key has already been added to _keys.
    mapping(bytes32 => bool) private _keyExists;

    // ─── Events ──────────────────────────────────────────────────────

    event ParamSet(bytes32 indexed key, uint256 oldValue, uint256 newValue);
    event ParamBatchSet(bytes32[] keys, uint256[] values);

    // ─── Errors ──────────────────────────────────────────────────────

    error InvalidAddress();
    error ArrayLengthMismatch();
    error EmptyBatch();

    // ─── Initializer ─────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the registry.
     * @param admin  The address that receives DEFAULT_ADMIN_ROLE and GOVERNOR_ROLE.
     *               GOVERNOR_ROLE is later transferred to ClawDAO.
     */
    function initialize(address admin) public initializer {
        if (admin == address(0)) revert InvalidAddress();

        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, admin);
    }

    // ─── Core Functions ──────────────────────────────────────────────

    /**
     * @notice Set a single parameter. Only callable by GOVERNOR_ROLE.
     * @param key   The parameter key (use defined constants above).
     * @param value The new value.
     */
    function setParam(bytes32 key, uint256 value) external onlyRole(GOVERNOR_ROLE) {
        uint256 oldValue = _params[key];
        _params[key] = value;

        if (!_keyExists[key]) {
            _keys.push(key);
            _keyExists[key] = true;
        }

        emit ParamSet(key, oldValue, value);
    }

    /**
     * @notice Set multiple parameters in a single transaction.
     * @param keys_   Array of parameter keys.
     * @param values  Array of parameter values (must match keys length).
     */
    function setBatchParams(
        bytes32[] calldata keys_,
        uint256[] calldata values
    ) external onlyRole(GOVERNOR_ROLE) {
        if (keys_.length == 0) revert EmptyBatch();
        if (keys_.length != values.length) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < keys_.length; i++) {
            uint256 oldValue = _params[keys_[i]];
            _params[keys_[i]] = values[i];

            if (!_keyExists[keys_[i]]) {
                _keys.push(keys_[i]);
                _keyExists[keys_[i]] = true;
            }

            emit ParamSet(keys_[i], oldValue, values[i]);
        }

        emit ParamBatchSet(keys_, values);
    }

    /**
     * @notice Read a parameter value. Returns 0 if not set.
     * @param key The parameter key.
     * @return value The stored value (0 if unset).
     */
    function getParam(bytes32 key) external view returns (uint256) {
        return _params[key];
    }

    /**
     * @notice Read a parameter value with a fallback default.
     * @param key          The parameter key.
     * @param defaultValue The value to return if the parameter has not been set.
     * @return value       The stored value, or defaultValue if 0.
     */
    function getParamWithDefault(bytes32 key, uint256 defaultValue) external view returns (uint256) {
        uint256 v = _params[key];
        return v != 0 ? v : defaultValue;
    }

    // ─── View Helpers ────────────────────────────────────────────────

    /**
     * @notice Get the number of distinct keys that have been set.
     */
    function keyCount() external view returns (uint256) {
        return _keys.length;
    }

    /**
     * @notice Get all keys and their current values.
     * @dev May be expensive for large registries — use off-chain for enumeration.
     */
    function getAllParams() external view returns (bytes32[] memory, uint256[] memory) {
        uint256 len = _keys.length;
        uint256[] memory values = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            values[i] = _params[_keys[i]];
        }
        return (_keys, values);
    }

    // ─── Upgrade ─────────────────────────────────────────────────────

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {} // solhint-disable-line no-empty-blocks
}
