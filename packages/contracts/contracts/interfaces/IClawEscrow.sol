// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IClawEscrow
 * @notice Interface for the ClawEscrow contract.
 */
interface IClawEscrow {
    enum EscrowStatus { Active, Released, Refunded, Expired, Disputed }

    // ─── Events ──────────────────────────────────────────────────────

    event EscrowCreated(
        bytes32 indexed escrowId,
        address indexed depositor,
        address indexed beneficiary,
        address arbiter,
        uint256 amount,
        uint256 fee,
        uint256 expiresAt
    );
    event EscrowFunded(bytes32 indexed escrowId, address indexed funder, uint256 amount);
    event EscrowReleased(bytes32 indexed escrowId, address indexed releasedBy);
    event EscrowRefunded(bytes32 indexed escrowId, address indexed refundedBy);
    event EscrowExpired(bytes32 indexed escrowId, address indexed caller);
    event EscrowDisputed(bytes32 indexed escrowId, address indexed disputedBy);
    event EscrowResolved(bytes32 indexed escrowId, address indexed arbiter, bool releasedToBeneficiary);

    // ─── Core ────────────────────────────────────────────────────────

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

    // ─── View ────────────────────────────────────────────────────────

    function getEscrow(bytes32 escrowId)
        external
        view
        returns (
            address depositor,
            address beneficiary,
            address arbiter,
            uint256 amount,
            uint256 createdAt,
            uint256 expiresAt,
            EscrowStatus status
        );

    function calculateFee(uint256 amount, uint256 holdingDays) external view returns (uint256);
}
