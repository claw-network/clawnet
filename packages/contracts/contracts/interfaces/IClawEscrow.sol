// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IClawEscrow
 * @notice Interface for the ClawEscrow contract.
 */
interface IClawEscrow {
    enum EscrowStatus { Active, Released, Refunded, Expired, Disputed }

    function createEscrow(
        bytes32 escrowId,
        address beneficiary,
        address arbiter,
        uint256 amount,
        uint256 expiresAt
    ) external;

    function fund(bytes32 escrowId, uint256 amount) external;
    function release(bytes32 escrowId) external;
    function refund(bytes32 escrowId) external;
    function expire(bytes32 escrowId) external;
    function dispute(bytes32 escrowId) external;
    function resolve(bytes32 escrowId, bool releaseToBeneficiary) external;
}
