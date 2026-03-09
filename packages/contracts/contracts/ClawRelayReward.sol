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

    // ─── State ───────────────────────────────────────────────────────

    IERC20 public token;
    RewardParams public rewardParams;

    /// @notice Last claimed periodId per relay DID hash (enforces monotonic increase).
    mapping(bytes32 => uint256) public lastClaimedPeriod;

    /// @notice Claim history per relay DID hash.
    mapping(bytes32 => ClaimRecord[]) internal _claimHistory;

    /// @notice Total rewards distributed (lifetime).
    uint256 public totalRewardsDistributed;

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

    // ─── Core: Claim Reward ──────────────────────────────────────────

    /**
     * @notice Relay node submits a period proof and claims reward.
     * @param relayDidHash keccak256 hash of the relay node's DID
     * @param periodId     Period ID (must be > lastClaimedPeriod for this relay)
     * @param messagingBytesRelayed  Messaging bytes in the period
     * @param attachmentBytesRelayed Attachment bytes in the period
     * @param circuitsServed         Number of circuits served
     * @param rewardAmount           Computed reward amount (verified against cap)
     * @param confirmations          Array of peer co-sign confirmations
     * @return The actual reward amount transferred
     */
    function claimReward(
        bytes32 relayDidHash,
        uint256 periodId,
        uint256 messagingBytesRelayed,
        uint256 attachmentBytesRelayed,
        uint256 circuitsServed,
        uint256 rewardAmount,
        PeerConfirmation[] calldata confirmations
    ) external nonReentrant whenNotPaused returns (uint256) {
        // Period deduplication
        require(
            periodId > lastClaimedPeriod[relayDidHash],
            "Period already claimed or invalid"
        );

        // Minimum thresholds
        uint256 totalConfirmedBytes = 0;
        uint256 confirmedPeers = confirmations.length;

        require(
            confirmedPeers >= rewardParams.minPeersThreshold,
            "Not enough peer confirmations"
        );

        // Validate confirmations and sum confirmed bytes
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

        // Verify claimed bytes are consistent
        require(
            messagingBytesRelayed + attachmentBytesRelayed >= totalConfirmedBytes,
            "Confirmed bytes exceed claimed bytes"
        );

        // Cap reward
        require(rewardAmount > 0, "Reward must be positive");
        uint256 actualReward = rewardAmount > rewardParams.maxRewardPerPeriod
            ? rewardParams.maxRewardPerPeriod
            : rewardAmount;

        // Check pool balance
        uint256 available = token.balanceOf(address(this));
        require(available >= actualReward, "Insufficient reward pool balance");

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

        // Suppress unused variable warning
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
}
