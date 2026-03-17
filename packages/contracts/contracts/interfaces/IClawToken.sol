// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IClawToken
 * @notice Interface for the ClawToken ERC-20 contract (with ERC20Votes support).
 */
interface IClawToken {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function pause() external;
    function unpause() external;
    function decimals() external pure returns (uint8);

    // ─── ERC20Votes ──────────────────────────────────────────────────

    /// @notice Get historical voting power at a past block number.
    function getPastVotes(address account, uint256 timepoint) external view returns (uint256);
    /// @notice Get historical total supply at a past block number.
    function getPastTotalSupply(uint256 timepoint) external view returns (uint256);
    /// @notice Get current voting power (latest checkpoint).
    function getVotes(address account) external view returns (uint256);
    /// @notice Delegate voting power to another address.
    function delegate(address delegatee) external;
}
