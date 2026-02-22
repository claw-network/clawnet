// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IClawStaking
 * @notice Interface for the ClawStaking contract.
 */
interface IClawStaking {
    // ─── Enums ───────────────────────────────────────────────────────

    enum NodeType {
        Validator,
        Relay,
        Matcher,
        Arbiter,
        Indexer
    }

    // ─── Events ──────────────────────────────────────────────────────

    event Staked(address indexed node, uint256 amount, NodeType nodeType);
    event UnstakeRequested(address indexed node, uint64 unlockAt);
    event Unstaked(address indexed node, uint256 returned);
    event RewardClaimed(address indexed node, uint256 amount);
    event Slashed(address indexed node, uint256 amount, bytes32 reason);
    event RewardsDistributed(uint256 totalAmount, uint256 validatorCount);

    // ─── Core functions ──────────────────────────────────────────────

    function stake(uint256 amount, NodeType nodeType) external;
    function requestUnstake() external;
    function unstake() external;
    function claimRewards() external;
    function slash(address node, uint256 amount, bytes32 reason) external;
    function distributeRewards(address[] calldata validators, uint256[] calldata amounts) external;

    // ─── View functions ──────────────────────────────────────────────

    function isActiveValidator(address node) external view returns (bool);
    function getActiveValidators() external view returns (address[] memory);
    function activeValidatorCount() external view returns (uint256);
}
