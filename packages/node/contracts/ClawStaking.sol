// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./ParamRegistry.sol";

/**
 * @title ClawStaking
 * @notice Node staking, unstaking, slashing, and reward distribution.
 *         Nodes must stake Token to participate in the network.
 * @dev UUPS upgradeable. Phase 2 will read params from ParamRegistry.
 *
 *  MVP defaults:
 *    minStake          = 10,000 Token
 *    unstakeCooldown   = 7 days
 *    slashPerViolation = 1 Token
 */
contract ClawStaking is
    AccessControlUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    // ─── Roles ───────────────────────────────────────────────────────

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @notice Can slash nodes (DAO / arbitration contract).
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    /// @notice Can distribute epoch rewards.
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    // ─── Enums ───────────────────────────────────────────────────────

    enum NodeType {
        Validator,
        Relay,
        Matcher,
        Arbiter,
        Indexer
    }

    // ─── Structs ─────────────────────────────────────────────────────

    struct StakeInfo {
        uint256  amount;             // Staked Token amount
        uint64   stakedAt;           // Stake creation timestamp
        uint64   unstakeRequestAt;   // 0 = no unstake request pending
        uint256  rewards;            // Accumulated unclaimed rewards
        uint256  slashed;            // Cumulative slashed amount
        NodeType nodeType;           // Node role
        bool     active;             // Currently active validator
    }

    // ─── State ───────────────────────────────────────────────────────

    IERC20 public token;

    uint256 public minStake;           // Minimum stake (DAO-adjustable)
    uint64  public unstakeCooldown;    // Cooldown period in seconds
    uint256 public rewardPerEpoch;     // Reward per epoch (informational)
    uint256 public slashPerViolation;  // Default slash per violation

    /// @notice Optional ParamRegistry for governance-controlled params.
    ///         When set, staking params are read from registry (with local fallbacks).
    ParamRegistry public paramRegistry;

    mapping(address => StakeInfo) public stakes;

    /// @notice List of currently active validators.
    address[] internal _activeValidators;

    /// @notice Index+1 in _activeValidators for O(1) remove. 0 = not in list.
    mapping(address => uint256) internal _activeIndex;

    /// @notice Sum of all principal staked amounts (for reserve accounting).
    uint256 public totalStaked;
    /// @notice Sum of all credited but unclaimed reward amounts (for reserve accounting).
    uint256 public totalPendingRewards;

    /// @notice DAO treasury address. When set, slashed tokens are forwarded here.
    address public daoTreasury;

    // ─── Events ──────────────────────────────────────────────────────

    event Staked(address indexed node, uint256 amount, NodeType nodeType);
    event UnstakeRequested(address indexed node, uint64 unlockAt);
    event Unstaked(address indexed node, uint256 returned);
    event RewardClaimed(address indexed node, uint256 amount);
    event Slashed(address indexed node, uint256 amount, bytes32 reason);
    event RewardsDistributed(uint256 totalAmount, uint256 validatorCount);
    event StakingParamsInitialized(uint256 minStake, uint64 unstakeCooldown, uint256 slashPerViolation);
    event DaoTreasurySet(address indexed treasury);

    // ─── Errors ──────────────────────────────────────────────────────

    error AlreadyStaked();
    error NotStaked();
    error InsufficientStake(uint256 provided, uint256 required);
    error UnstakeNotRequested();
    error CooldownNotElapsed(uint64 unlockAt, uint256 currentTime);
    error AlreadyRequestedUnstake();
    error NoRewards();
    error InvalidAddress();
    error InvalidAmount();
    error ArrayLengthMismatch();

    // ─── Initializer ─────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @param tokenAddress       ClawToken ERC-20 address.
     * @param minStake_          Minimum stake in Token.
     * @param unstakeCooldown_   Cooldown period in seconds.
     * @param rewardPerEpoch_    Reward per epoch (informational).
     * @param slashPerViolation_ Default slash amount per violation.
     */
    function initialize(
        address tokenAddress,
        uint256 minStake_,
        uint64  unstakeCooldown_,
        uint256 rewardPerEpoch_,
        uint256 slashPerViolation_
    ) public initializer {
        if (tokenAddress == address(0)) revert InvalidAddress();

        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(SLASHER_ROLE, msg.sender);
        _grantRole(DISTRIBUTOR_ROLE, msg.sender);

        token = IERC20(tokenAddress);
        minStake = minStake_;
        unstakeCooldown = unstakeCooldown_;
        rewardPerEpoch = rewardPerEpoch_;
        slashPerViolation = slashPerViolation_;

        emit StakingParamsInitialized(minStake_, unstakeCooldown_, slashPerViolation_);
    }

    // ─── Core functions ──────────────────────────────────────────────

    /**
     * @notice Stake Token to become a node. Caller must have approved `amount`.
     * @param amount   Token amount to stake (must be >= minStake).
     * @param nodeType The role of this node.
     */
    function stake(uint256 amount, NodeType nodeType) external whenNotPaused nonReentrant {
        StakeInfo storage existing = stakes[msg.sender];
        if (existing.active) revert AlreadyStaked();
        // #3 fix: block restaking while an unstake is still pending to prevent
        // overwriting the pending withdrawal and permanently stranding funds.
        if (existing.unstakeRequestAt != 0) revert("Unstake pending: complete unstake first");
        uint256 _minStake = _getMinStake();
        if (amount < _minStake) revert InsufficientStake(amount, _minStake);

        token.safeTransferFrom(msg.sender, address(this), amount);

        stakes[msg.sender] = StakeInfo({
            amount: amount,
            stakedAt: uint64(block.timestamp),
            unstakeRequestAt: 0,
            rewards: 0,
            slashed: 0,
            nodeType: nodeType,
            active: true
        });

        // Add to active list
        _activeValidators.push(msg.sender);
        _activeIndex[msg.sender] = _activeValidators.length; // 1-indexed

        // #4 fix: track total staked principal for reserve accounting
        totalStaked += amount;

        emit Staked(msg.sender, amount, nodeType);
    }

    /**
     * @notice Request to unstake. Starts the cooldown timer.
     *         The node is removed from active validators immediately.
     */
    function requestUnstake() external whenNotPaused {
        StakeInfo storage s = stakes[msg.sender];
        if (!s.active) revert NotStaked();
        if (s.unstakeRequestAt != 0) revert AlreadyRequestedUnstake();

        s.unstakeRequestAt = uint64(block.timestamp);
        s.active = false;

        // Remove from active list
        _removeFromActiveList(msg.sender);

        uint64 unlockAt = uint64(block.timestamp) + _getUnstakeCooldown();
        emit UnstakeRequested(msg.sender, unlockAt);
    }

    /**
     * @notice Complete unstaking after cooldown. Returns staked amount minus slashed.
     */
    function unstake() external whenNotPaused nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        if (s.amount == 0) revert NotStaked();
        if (s.unstakeRequestAt == 0) revert UnstakeNotRequested();

        uint64 unlockAt = s.unstakeRequestAt + _getUnstakeCooldown();
        if (block.timestamp < unlockAt) {
            revert CooldownNotElapsed(unlockAt, block.timestamp);
        }

        // Calculate return: amount - slashed
        uint256 principal = s.amount;
        uint256 pendingRewards = s.rewards;
        uint256 returned = s.slashed >= principal ? 0 : principal - s.slashed;

        // #4 fix: update reserve accounting before clearing stake.
        // Deduct only the effective (un-slashed) portion — the slashed portion
        // was already deducted from totalStaked inside slash().
        totalStaked -= returned;
        totalPendingRewards -= pendingRewards;

        // Clear stake
        delete stakes[msg.sender];

        if (returned > 0) {
            token.safeTransfer(msg.sender, returned);
        }

        emit Unstaked(msg.sender, returned);
    }

    /**
     * @notice Claim accumulated rewards.
     */
    function claimRewards() external whenNotPaused nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        if (s.amount == 0) revert NotStaked();
        if (s.rewards == 0) revert NoRewards();

        uint256 amount = s.rewards;
        s.rewards = 0;
        // #4 fix: reduce pending rewards reserve when rewards are claimed
        totalPendingRewards -= amount;

        token.safeTransfer(msg.sender, amount);

        emit RewardClaimed(msg.sender, amount);
    }

    /**
     * @notice Slash a staked node. Only callable by SLASHER_ROLE (DAO / arbitration).
     * @param node   The node address to slash.
     * @param amount Token amount to slash. Capped at staked amount.
     * @param reason Identifier for the violation type.
     */
    function slash(
        address node,
        uint256 amount,
        bytes32 reason
    ) external whenNotPaused onlyRole(SLASHER_ROLE) {
        StakeInfo storage s = stakes[node];
        if (s.amount == 0) revert NotStaked();
        if (amount == 0) revert InvalidAmount();

        // Cap at remaining (amount - slashed)
        uint256 remaining = s.amount > s.slashed ? s.amount - s.slashed : 0;
        uint256 actualSlash = amount > remaining ? remaining : amount;

        s.slashed += actualSlash;
        // #4 fix: reduce total staked principal by the slashed amount
        totalStaked -= actualSlash;

        // #7 fix: if the node is now fully slashed (zero effective stake),
        // deactivate it immediately rather than waiting for voluntary unstake.
        uint256 effectiveStake = s.amount > s.slashed ? s.amount - s.slashed : 0;
        if (effectiveStake == 0 && s.active) {
            s.active = false;
            _removeFromActiveList(node);
        }

        emit Slashed(node, actualSlash, reason);

        // Forward slashed tokens to DAO treasury if configured
        if (daoTreasury != address(0) && actualSlash > 0) {
            token.safeTransfer(daoTreasury, actualSlash);
        }
    }

    /**
     * @notice Distribute epoch rewards to validators.
     *         The contract must hold sufficient Token (pre-funded by treasury/minting).
     * @param validators Array of validator addresses.
     * @param amounts    Array of reward amounts per validator.
     */
    function distributeRewards(
        address[] calldata validators,
        uint256[] calldata amounts
    ) external whenNotPaused onlyRole(DISTRIBUTOR_ROLE) {
        if (validators.length != amounts.length) revert ArrayLengthMismatch();

        uint256 total = 0;
        for (uint256 i = 0; i < validators.length; i++) {
            StakeInfo storage s = stakes[validators[i]];
            if (s.amount > 0) {
                s.rewards += amounts[i];
                total += amounts[i];
            }
        }

        // #4 fix: ensure the contract holds enough liquid balance to cover
        // the newly credited rewards (liquid = balance - staked principal - already-pending rewards).
        uint256 newPendingRewards = totalPendingRewards + total;
        require(
            token.balanceOf(address(this)) >= totalStaked + newPendingRewards,
            "Insufficient liquid balance for rewards"
        );
        totalPendingRewards = newPendingRewards;

        emit RewardsDistributed(total, validators.length);
    }

    // ─── View functions ──────────────────────────────────────────────

    /**
     * @notice Check if an address is an active validator.
     */
    function isActiveValidator(address node) external view returns (bool) {
        return stakes[node].active;
    }

    /**
     * @notice Get the full stake info for a node.
     */
    function getStakeInfo(address node) external view returns (StakeInfo memory) {
        return stakes[node];
    }

    /**
     * @notice Get the list of active validators.
     */
    function getActiveValidators() external view returns (address[] memory) {
        return _activeValidators;
    }

    /**
     * @notice Get the number of active validators.
     */
    function activeValidatorCount() external view returns (uint256) {
        return _activeValidators.length;
    }

    /**
     * @notice Get the lockup multiplier for a staked node.
     * @dev Tiered multiplier based on lock duration (time since stakedAt):
     *        < 30 days  → 1000 (1.0x)
     *       30–89 days  → 1000–1499 (1.0x–1.5x, linearly interpolated)
     *       90–179 days → 1500–1999 (1.5x–2.0x, linearly interpolated)
     *      180–364 days → 2000–2999 (2.0x–3.0x, linearly interpolated)
     *       ≥ 365 days  → 3000 (3.0x cap)
     *
     *      ClawDAO clamps the returned value to [1000, 3000].
     * @param node The staker address.
     * @return multiplier 1000-based multiplier (1000 = 1x, 2000 = 2x, etc.)
     */
    function getLockupMultiplier(address node) external view returns (uint256) {
        StakeInfo storage s = stakes[node];
        if (s.amount == 0 || !s.active) return 1000;

        uint256 elapsed = block.timestamp - uint256(s.stakedAt);

        // Tier thresholds in seconds
        uint256 tier1 = 30 days;   //  30d → 1000
        uint256 tier2 = 90 days;   //  90d → 1500
        uint256 tier3 = 180 days;  // 180d → 2000
        uint256 tier4 = 365 days;  // 365d → 3000

        if (elapsed < tier1) {
            return 1000;
        } else if (elapsed < tier2) {
            // Linear interpolation: 1000 → 1500 over 60 days
            return 1000 + (500 * (elapsed - tier1)) / (tier2 - tier1);
        } else if (elapsed < tier3) {
            // Linear interpolation: 1500 → 2000 over 90 days
            return 1500 + (500 * (elapsed - tier2)) / (tier3 - tier2);
        } else if (elapsed < tier4) {
            // Linear interpolation: 2000 → 3000 over 185 days
            return 2000 + (1000 * (elapsed - tier3)) / (tier4 - tier3);
        } else {
            return 3000;
        }
    }

    // ─── Admin ───────────────────────────────────────────────────────

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @notice Update staking parameters. Phase 2 will move to ParamRegistry.
     */
    function setParams(
        uint256 minStake_,
        uint64  unstakeCooldown_,
        uint256 rewardPerEpoch_,
        uint256 slashPerViolation_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minStake = minStake_;
        unstakeCooldown = unstakeCooldown_;
        rewardPerEpoch = rewardPerEpoch_;
        slashPerViolation = slashPerViolation_;
    }

    /**
     * @notice Set the ParamRegistry for governance-controlled staking parameters.
     *         Pass address(0) to disable registry and use local storage only.
     */
    function setParamRegistry(address registryAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        paramRegistry = ParamRegistry(registryAddress);
    }

    /**
     * @notice Set the DAO treasury address for receiving slashed tokens.
     *         Pass address(0) to disable forwarding (tokens stay in contract).
     */
    function setDaoTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasury_ == address(this)) revert InvalidAddress();
        daoTreasury = treasury_;
        emit DaoTreasurySet(treasury_);
    }

    // ─── Internal ────────────────────────────────────────────────────

    /// @dev Read minStake from ParamRegistry if set, otherwise use local storage.
    function _getMinStake() internal view returns (uint256) {
        if (address(paramRegistry) != address(0)) {
            return paramRegistry.getParamWithDefault(paramRegistry.MIN_NODE_STAKE(), minStake);
        }
        return minStake;
    }

    /// @dev Read unstakeCooldown from ParamRegistry if set, otherwise use local storage.
    function _getUnstakeCooldown() internal view returns (uint64) {
        if (address(paramRegistry) != address(0)) {
            return uint64(paramRegistry.getParamWithDefault(paramRegistry.UNSTAKE_COOLDOWN(), uint256(unstakeCooldown)));
        }
        return unstakeCooldown;
    }

    /// @dev Read slashPerViolation from ParamRegistry if set, otherwise use local storage.
    function _getSlashPerViolation() internal view returns (uint256) {
        if (address(paramRegistry) != address(0)) {
            return paramRegistry.getParamWithDefault(paramRegistry.SLASH_PER_VIOLATION(), slashPerViolation);
        }
        return slashPerViolation;
    }

    /**
     * @dev Remove an address from _activeValidators using swap-and-pop.
     */
    function _removeFromActiveList(address node) internal {
        uint256 idx = _activeIndex[node];
        if (idx == 0) return; // not in list

        uint256 lastIdx = _activeValidators.length;
        if (idx != lastIdx) {
            // Swap with last element
            address lastNode = _activeValidators[lastIdx - 1];
            _activeValidators[idx - 1] = lastNode;
            _activeIndex[lastNode] = idx;
        }
        _activeValidators.pop();
        delete _activeIndex[node];
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {} // solhint-disable-line no-empty-blocks
}
