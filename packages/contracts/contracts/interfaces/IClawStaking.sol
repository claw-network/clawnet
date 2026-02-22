// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IClawStaking
 * @notice Interface for the ClawStaking contract.
 */
interface IClawStaking {
    function stake(uint256 amount, uint8 nodeType) external;
    function requestUnstake() external;
    function unstake() external;
    function claimRewards() external;
    function slash(address node, uint256 amount, bytes32 reason) external;
    function distributeRewards(address[] calldata validators, uint256[] calldata amounts) external;
    function isActiveValidator(address node) external view returns (bool);
}
