// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IClawToken
 * @notice Interface for the ClawToken ERC-20 contract.
 */
interface IClawToken {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function pause() external;
    function unpause() external;
    function decimals() external pure returns (uint8);
}
