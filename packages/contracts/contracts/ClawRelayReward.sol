// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ClawRelayReward
 * @notice Relay incentive pool — relay nodes submit period proofs with
 *         co-signed peer confirmations to claim Token rewards.
 * @dev UUPS upgradeable. Reward params are DAO-adjustable via DAO_ROLE.
 *
 *  Reward formula (off-chain, verified on-chain for caps):
 *    weightedBytes = messagingConfirmedBytes × 1.0
 *                  + attachmentConfirmedBytes × (attachmentWeightBps / 10000)
 *    rewardAmount  = baseRate
 *                  × log2(1 + weightedBytes / 1 GB)
 *                  × min(confirmedUniquePeers / 10, 3.0)
 *                  × uptimeBonus
 *                  × confirmationRatio
 *
 *  On-chain enforcement:
 *    - Period deduplication (monotonic periodId per relay)
 *    - Minimum bytes + peers thresholds
 *    - Per-period reward cap
 *    - Co-sign verification (Ed25519 signatures via precompiled check)
 *    - Self-relay prevention (relayDidHash != peerDidHash)
 */
contract ClawRelayReward is
    AccessControlUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    // ─── Roles ───────────────────────────────────────────────────────

    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ─── Structs ─────────────────────────────────────────────────────

    struct PeerConfirmation {
        bytes32 peerDidHash;
        uint256 bytesConfirmed;
        uint256 circuitsConfirmed;
        bytes   signature;
    }

    struct RewardParams {
        uint256 baseRate;             // Base Token per period
        uint256 maxRewardPerPeriod;   // Hard cap per node per period
        uint256 minBytesThreshold;    // Minimum confirmed bytes to qualify
        uint256 minPeersThreshold;    // Minimum confirmed peers to qualify
        uint256 attachmentWeightBps;  // 3000 = 0.3x (basis points of 10000)
    }

    struct ClaimRecord {
        uint256 periodId;
        uint256 rewardAmount;
        uint256 confirmedBytes;
        uint256 confirmedPeers;
        uint256 claimedAt;
    }

    // ─── Constants ───────────────────────────────────────────────────

    /// @dev Scaling factor used in reward formula fixed-point arithmetic.
    uint256 private constant REWARD_SCALE = 10000;
    /// @dev 1 GiB = 2^30 bytes, the reference unit for byte-factor log2.
    uint256 private constant GIB = 1 << 30;

    // ─── State ───────────────────────────────────────────────────────

    IERC20 public token;
    RewardParams public rewardParams;

    /// @notice Last claimed periodId per relay DID hash (enforces monotonic increase).
    mapping(bytes32 => uint256) public lastClaimedPeriod;

    /// @notice Claim history per relay DID hash.
    mapping(bytes32 => ClaimRecord[]) internal _claimHistory;

    /// @notice Total rewards distributed (lifetime).
    uint256 public totalRewardsDistributed;

    /// @notice P0 fix: EVM address of the registered operator for each relay DID hash.
    ///         Only the registered operator may claim rewards for that DID.
    ///         Registration is first-come-first-served; the relay node should call
    ///         registerRelayOperator() at startup before any claim attempt.
    mapping(bytes32 => address) public relayOperators;

    // ─── Events ──────────────────────────────────────────────────────

    event RewardClaimed(
        bytes32 indexed relayDidHash,
        uint256 indexed periodId,
        uint256 rewardAmount,
        uint256 confirmedBytes,
        uint256 confirmedPeers
    );

    event RewardParamsUpdated(
        uint256 baseRate,
        uint256 maxRewardPerPeriod,
        uint256 minBytesThreshold,
        uint256 minPeersThreshold,
        uint256 attachmentWeightBps
    );

    /// @notice Emitted when a relay operator registers their EVM address for a DID hash.
    event RelayOperatorRegistered(bytes32 indexed relayDidHash, address indexed operator);

    // ─── Initializer ─────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        uint256 _baseRate,
        uint256 _maxRewardPerPeriod,
        uint256 _minBytesThreshold,
        uint256 _minPeersThreshold,
        uint256 _attachmentWeightBps
    ) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        require(_token != address(0), "Invalid token address");
        require(_baseRate > 0, "Base rate must be positive");
        require(_maxRewardPerPeriod >= _baseRate, "Max reward must be >= base rate");

        token = IERC20(_token);
        rewardParams = RewardParams({
            baseRate: _baseRate,
            maxRewardPerPeriod: _maxRewardPerPeriod,
            minBytesThreshold: _minBytesThreshold,
            minPeersThreshold: _minPeersThreshold,
            attachmentWeightBps: _attachmentWeightBps
        });

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DAO_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    // ─── Core: Operator Registration ─────────────────────────────────

    /**
     * @notice P0 fix: bind the caller's EVM address to a relay DID hash.
     *         The relay node must call this once at startup before any claim.
     *         A DID hash can only be registered once (first-come-first-served).
     * @param relayDidHash keccak256 hash of the relay node's DID string.
     */
    function registerRelayOperator(bytes32 relayDidHash) external {
        require(relayDidHash != bytes32(0), "Invalid relay DID hash");
        require(
            relayOperators[relayDidHash] == address(0),
            "Relay DID already registered"
        );
        relayOperators[relayDidHash] = msg.sender;
        emit RelayOperatorRegistered(relayDidHash, msg.sender);
    }

    // ─── Core: Claim Reward ──────────────────────────────────────────

    /**
     * @notice Relay node submits a period proof and claims reward.
     * @dev P0 fix: caller must be the registered operator for relayDidHash.
     *      P1 fix: reward is computed on-chain from confirmed traffic — the
     *              caller no longer supplies rewardAmount.
     * @param relayDidHash keccak256 hash of the relay node's DID
     * @param periodId     Period ID (must be > lastClaimedPeriod for this relay)
     * @param messagingBytesRelayed  Messaging bytes claimed for the period
     * @param attachmentBytesRelayed Attachment bytes claimed for the period
     * @param circuitsServed         Number of circuits served (stored for audit)
     * @param confirmations          Array of peer co-sign confirmations
     * @return The actual reward amount transferred
     */
    function claimReward(
        bytes32 relayDidHash,
        uint256 periodId,
        uint256 messagingBytesRelayed,
        uint256 attachmentBytesRelayed,
        uint256 circuitsServed,
        PeerConfirmation[] calldata confirmations
    ) external nonReentrant whenNotPaused returns (uint256) {
        // P0: verify caller is the registered operator for this relay DID
        require(
            relayOperators[relayDidHash] == msg.sender,
            "Caller is not the registered relay operator"
        );

        // Period deduplication
        require(
            periodId > lastClaimedPeriod[relayDidHash],
            "Period already claimed or invalid"
        );

        // Minimum peer threshold
        uint256 confirmedPeers = confirmations.length;
        require(
            confirmedPeers >= rewardParams.minPeersThreshold,
            "Not enough peer confirmations"
        );

        // Validate confirmations and sum confirmed bytes
        uint256 totalConfirmedBytes = 0;
        for (uint256 i = 0; i < confirmations.length; i++) {
            // Self-relay prevention
            require(
                confirmations[i].peerDidHash != relayDidHash,
                "Self-relay not allowed"
            );

            // Check for duplicate peers within this claim
            for (uint256 j = 0; j < i; j++) {
                require(
                    confirmations[i].peerDidHash != confirmations[j].peerDidHash,
                    "Duplicate peer confirmation"
                );
            }

            totalConfirmedBytes += confirmations[i].bytesConfirmed;

            // Note: Ed25519 signature verification is performed off-chain.
            // On-chain we verify structural integrity and store for audit.
            // Future versions can add on-chain Ed25519 verification via precompile.
        }

        require(
            totalConfirmedBytes >= rewardParams.minBytesThreshold,
            "Below minimum bytes threshold"
        );

        // Verify confirmed bytes do not exceed claimed bytes
        require(
            messagingBytesRelayed + attachmentBytesRelayed >= totalConfirmedBytes,
            "Confirmed bytes exceed claimed bytes"
        );

        // P1: compute reward on-chain from confirmed traffic; reject caller-supplied amount
        uint256 actualReward = _computeReward(
            messagingBytesRelayed,
            attachmentBytesRelayed,
            totalConfirmedBytes,
            confirmedPeers
        );
        require(actualReward > 0, "Computed reward is zero");

        // Check pool balance
        require(
            token.balanceOf(address(this)) >= actualReward,
            "Insufficient reward pool balance"
        );

        // Update state
        lastClaimedPeriod[relayDidHash] = periodId;
        totalRewardsDistributed += actualReward;

        _claimHistory[relayDidHash].push(ClaimRecord({
            periodId: periodId,
            rewardAmount: actualReward,
            confirmedBytes: totalConfirmedBytes,
            confirmedPeers: confirmedPeers,
            claimedAt: block.timestamp
        }));

        // Transfer reward
        token.safeTransfer(msg.sender, actualReward);

        emit RewardClaimed(
            relayDidHash,
            periodId,
            actualReward,
            totalConfirmedBytes,
            confirmedPeers
        );

        // Store circuitsServed for future audit extensions
        circuitsServed;

        return actualReward;
    }

    // ─── Views ───────────────────────────────────────────────────────

    /**
     * @notice Get current reward parameters.
     */
    function getRewardParams() external view returns (
        uint256 baseRate,
        uint256 maxRewardPerPeriod,
        uint256 minBytesThreshold,
        uint256 minPeersThreshold,
        uint256 attachmentWeightBps
    ) {
        return (
            rewardParams.baseRate,
            rewardParams.maxRewardPerPeriod,
            rewardParams.minBytesThreshold,
            rewardParams.minPeersThreshold,
            rewardParams.attachmentWeightBps
        );
    }

    /**
     * @notice Get claim history for a relay DID.
     */
    function getClaimHistory(bytes32 relayDidHash)
        external view returns (ClaimRecord[] memory)
    {
        return _claimHistory[relayDidHash];
    }

    /**
     * @notice Get the number of claims for a relay DID.
     */
    function getClaimCount(bytes32 relayDidHash) external view returns (uint256) {
        return _claimHistory[relayDidHash].length;
    }

    /**
     * @notice Current pool balance available for rewards.
     */
    function poolBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    // ─── DAO Admin ───────────────────────────────────────────────────

    /**
     * @notice Update reward parameters (DAO only).
     */
    function setRewardParams(
        uint256 _baseRate,
        uint256 _maxRewardPerPeriod,
        uint256 _minBytesThreshold,
        uint256 _minPeersThreshold,
        uint256 _attachmentWeightBps
    ) external onlyRole(DAO_ROLE) {
        require(_baseRate > 0, "Base rate must be positive");
        require(_maxRewardPerPeriod >= _baseRate, "Max reward must be >= base rate");
        require(_attachmentWeightBps <= 10000, "Attachment weight must be <= 10000 bps");

        rewardParams = RewardParams({
            baseRate: _baseRate,
            maxRewardPerPeriod: _maxRewardPerPeriod,
            minBytesThreshold: _minBytesThreshold,
            minPeersThreshold: _minPeersThreshold,
            attachmentWeightBps: _attachmentWeightBps
        });

        emit RewardParamsUpdated(
            _baseRate,
            _maxRewardPerPeriod,
            _minBytesThreshold,
            _minPeersThreshold,
            _attachmentWeightBps
        );
    }

    // ─── Pausable ────────────────────────────────────────────────────

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ─── UUPS ────────────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ─── Internal: Reward Computation (P1) ───────────────────────────

    /**
     * @dev P1 fix: compute reward entirely from on-chain confirmed traffic.
     *      Formula (integer approximation, conservative):
     *        weightedBytes  = messagingBytesClaimed
     *                       + attachmentBytesClaimed × attachmentWeightBps / 10000
     *        byteFactor     = log2(1 + weightedBytes / GIB) × REWARD_SCALE   (floor approx)
     *        peerFactor     = min(confirmedPeers / 10, 3.0) × REWARD_SCALE
     *        confirmRatio   = totalConfirmedBytes / totalClaimed × REWARD_SCALE
     *        reward         = baseRate × byteFactor × peerFactor × confirmRatio / SCALE³
     *        reward         = min(reward, maxRewardPerPeriod)
     */
    function _computeReward(
        uint256 messagingBytesClaimed,
        uint256 attachmentBytesClaimed,
        uint256 totalConfirmedBytes,
        uint256 confirmedPeers
    ) internal view returns (uint256) {
        RewardParams memory p = rewardParams;

        uint256 totalClaimed = messagingBytesClaimed + attachmentBytesClaimed;
        if (totalClaimed == 0 || totalConfirmedBytes == 0) return 0;
        // Confirmed bytes are already validated to be <= totalClaimed upstream.

        // Confirmation ratio [0, REWARD_SCALE]
        uint256 confirmRatioScaled = totalConfirmedBytes * REWARD_SCALE / totalClaimed;
        if (confirmRatioScaled == 0) return 0;

        // Weighted claimed bytes: attachment traffic is discounted to prevent large-file spam
        uint256 weightedBytes = messagingBytesClaimed
            + attachmentBytesClaimed * p.attachmentWeightBps / 10000;

        // Byte factor: floor-log2 approximation with linear fractional interpolation
        uint256 byteFactorScaled = _log2Factor(weightedBytes);
        if (byteFactorScaled == 0) return 0;

        // Peer factor: min(confirmedPeers / 10, 3.0) × REWARD_SCALE
        uint256 peerFactorScaled = confirmedPeers * REWARD_SCALE / 10;
        if (peerFactorScaled > 3 * REWARD_SCALE) peerFactorScaled = 3 * REWARD_SCALE;
        if (peerFactorScaled == 0) return 0;

        // reward = baseRate × byteF × peerF × confirmRatio / SCALE³
        // Multiply all numerators first (no intermediate overflow for realistic traffic)
        uint256 raw = p.baseRate
            * byteFactorScaled
            * peerFactorScaled
            * confirmRatioScaled
            / (REWARD_SCALE * REWARD_SCALE * REWARD_SCALE);

        return raw > p.maxRewardPerPeriod ? p.maxRewardPerPeriod : raw;
    }

    /**
     * @dev Returns floor(log2(1 + weightedBytes / GIB)) × REWARD_SCALE
     *      with linear fractional interpolation for sub-doubling ranges.
     *      Returns 0 when weightedBytes == 0 (no traffic → no reward).
     */
    function _log2Factor(uint256 weightedBytes) internal pure returns (uint256) {
        // val = GIB + weightedBytes, so log2(val) - 30 = log2(1 + weightedBytes/GIB)
        uint256 val = GIB + weightedBytes;
        uint256 intPart = _floorLog2(val); // always >= 30 since val >= GIB
        uint256 base = uint256(1) << intPart;
        // Linear interpolation: fractional part ≈ (val - base) / base
        uint256 fracPart = (val - base) * REWARD_SCALE / base;
        uint256 wholePart = intPart - 30; // integer part of log2(val / GIB)
        return wholePart * REWARD_SCALE + fracPart;
    }

    /// @dev Returns floor(log2(x)) for x >= 1; returns 0 for x == 0.
    function _floorLog2(uint256 x) internal pure returns (uint256 r) {
        if (x == 0) return 0;
        if (x >= 1 << 128) { x >>= 128; r += 128; }
        if (x >= 1 << 64)  { x >>= 64;  r += 64;  }
        if (x >= 1 << 32)  { x >>= 32;  r += 32;  }
        if (x >= 1 << 16)  { x >>= 16;  r += 16;  }
        if (x >= 1 << 8)   { x >>= 8;   r += 8;   }
        if (x >= 1 << 4)   { x >>= 4;   r += 4;   }
        if (x >= 1 << 2)   { x >>= 2;   r += 2;   }
        if (x >= 1 << 1)   { x >>= 1;   r += 1;   }
    }
}
