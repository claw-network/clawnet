// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ClawEscrow
 * @notice Token escrow with state machine: Active → Released | Refunded | Expired | Disputed.
 *         Disputed → Released | Refunded (via arbiter resolve).
 * @dev Interacts with ClawToken via IERC20. UUPS upgradeable.
 *      Fee formula: fee = max(minEscrowFee, ceil(amount * baseRate + amount * holdingRate * days))
 *      Phase 2 will read params from ParamRegistry; currently uses storage constants.
 */
contract ClawEscrow is
    AccessControlUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    // ─── Roles ───────────────────────────────────────────────────────

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ─── Enums ───────────────────────────────────────────────────────

    enum EscrowStatus {
        Active,
        Released,
        Refunded,
        Expired,
        Disputed
    }

    // ─── Structs ─────────────────────────────────────────────────────

    struct EscrowRecord {
        address depositor;
        address beneficiary;
        address arbiter;
        uint256 amount; // net amount held (after fee)
        uint256 createdAt;
        uint256 expiresAt;
        EscrowStatus status;
    }

    // ─── State ───────────────────────────────────────────────────────

    IERC20 public token;
    address public treasury;

    /// @notice Fee parameters (basis-point units where applicable).
    /// baseRate  = 100 → 1 %  (divided by 10 000)
    /// holdingRate = 5 → 0.05 % per day  (divided by 10 000)
    /// minEscrowFee = 1 Token
    uint256 public baseRate;
    uint256 public holdingRate;
    uint256 public minEscrowFee;

    mapping(bytes32 => EscrowRecord) public escrows;

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

    // ─── Errors ──────────────────────────────────────────────────────

    error EscrowAlreadyExists(bytes32 escrowId);
    error EscrowNotFound(bytes32 escrowId);
    error InvalidAmount();
    error InvalidExpiry();
    error InvalidAddress();
    error NotAuthorized();
    error InvalidStatus(EscrowStatus current, EscrowStatus expected);
    error NotExpiredYet(uint256 expiresAt, uint256 currentTime);

    // ─── Initializer ─────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @param tokenAddress   Address of the ClawToken ERC-20 contract.
     * @param treasuryAddress Address that receives escrow fees.
     * @param baseRate_      Fee base rate in basis points (e.g. 100 = 1%).
     * @param holdingRate_   Fee holding rate in basis points per day (e.g. 5 = 0.05%/day).
     * @param minEscrowFee_  Minimum fee in Token units.
     */
    function initialize(
        address tokenAddress,
        address treasuryAddress,
        uint256 baseRate_,
        uint256 holdingRate_,
        uint256 minEscrowFee_
    ) public initializer {
        if (tokenAddress == address(0)) revert InvalidAddress();
        if (treasuryAddress == address(0)) revert InvalidAddress();

        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);

        token = IERC20(tokenAddress);
        treasury = treasuryAddress;
        baseRate = baseRate_;
        holdingRate = holdingRate_;
        minEscrowFee = minEscrowFee_;
    }

    // ─── Core functions ──────────────────────────────────────────────

    /**
     * @notice Create a new escrow. The caller (depositor) must have
     *         approved `amount` Token for this contract beforehand.
     * @param escrowId    Unique identifier (typically keccak256 of off-chain data).
     * @param beneficiary Address that receives funds on release.
     * @param arbiter     Address that can resolve disputes.
     * @param amount      Total Token amount the depositor pays (including fees).
     * @param expiresAt   Unix timestamp after which anyone can expire the escrow.
     */
    function createEscrow(
        bytes32 escrowId,
        address beneficiary,
        address arbiter,
        uint256 amount,
        uint256 expiresAt
    ) external whenNotPaused nonReentrant {
        if (escrows[escrowId].depositor != address(0)) revert EscrowAlreadyExists(escrowId);
        if (beneficiary == address(0)) revert InvalidAddress();
        if (arbiter == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();

        // Calculate fee
        uint256 holdingDays = (expiresAt - block.timestamp + 86399) / 86400; // ceil(days)
        uint256 fee = _calculateFee(amount, holdingDays);

        uint256 netAmount = amount - fee;

        // Transfer total amount from depositor to this contract
        token.safeTransferFrom(msg.sender, address(this), amount);

        // Send fee to treasury
        if (fee > 0) {
            token.safeTransfer(treasury, fee);
        }

        escrows[escrowId] = EscrowRecord({
            depositor: msg.sender,
            beneficiary: beneficiary,
            arbiter: arbiter,
            amount: netAmount,
            createdAt: block.timestamp,
            expiresAt: expiresAt,
            status: EscrowStatus.Active
        });

        emit EscrowCreated(escrowId, msg.sender, beneficiary, arbiter, netAmount, fee, expiresAt);
    }

    /**
     * @notice Add more funds to an active escrow. Caller must approve the additional amount.
     * @param escrowId The escrow to fund.
     * @param amount   Additional Token amount (no fee charged on top-ups).
     */
    function fund(bytes32 escrowId, uint256 amount) external whenNotPaused nonReentrant {
        EscrowRecord storage e = _getEscrow(escrowId);
        if (e.status != EscrowStatus.Active) revert InvalidStatus(e.status, EscrowStatus.Active);
        if (amount == 0) revert InvalidAmount();

        token.safeTransferFrom(msg.sender, address(this), amount);
        e.amount += amount;

        emit EscrowFunded(escrowId, msg.sender, amount);
    }

    /**
     * @notice Release escrowed funds to the beneficiary.
     *         Callable by the depositor (voluntary release) or the arbiter.
     */
    function release(bytes32 escrowId) external whenNotPaused nonReentrant {
        EscrowRecord storage e = _getEscrow(escrowId);
        if (e.status != EscrowStatus.Active && e.status != EscrowStatus.Disputed) {
            revert InvalidStatus(e.status, EscrowStatus.Active);
        }
        if (msg.sender != e.depositor && msg.sender != e.arbiter) revert NotAuthorized();

        e.status = EscrowStatus.Released;
        token.safeTransfer(e.beneficiary, e.amount);

        emit EscrowReleased(escrowId, msg.sender);
    }

    /**
     * @notice Refund escrowed funds back to the depositor.
     *         Callable by the beneficiary (voluntary refund) or the arbiter.
     */
    function refund(bytes32 escrowId) external whenNotPaused nonReentrant {
        EscrowRecord storage e = _getEscrow(escrowId);
        if (e.status != EscrowStatus.Active && e.status != EscrowStatus.Disputed) {
            revert InvalidStatus(e.status, EscrowStatus.Active);
        }
        if (msg.sender != e.beneficiary && msg.sender != e.arbiter) revert NotAuthorized();

        e.status = EscrowStatus.Refunded;
        token.safeTransfer(e.depositor, e.amount);

        emit EscrowRefunded(escrowId, msg.sender);
    }

    /**
     * @notice Expire an escrow whose deadline has passed. Funds return to depositor.
     *         Callable by anyone.
     */
    function expire(bytes32 escrowId) external whenNotPaused nonReentrant {
        EscrowRecord storage e = _getEscrow(escrowId);
        if (e.status != EscrowStatus.Active) revert InvalidStatus(e.status, EscrowStatus.Active);
        if (block.timestamp < e.expiresAt) revert NotExpiredYet(e.expiresAt, block.timestamp);

        e.status = EscrowStatus.Expired;
        token.safeTransfer(e.depositor, e.amount);

        emit EscrowExpired(escrowId, msg.sender);
    }

    /**
     * @notice Raise a dispute on an active escrow.
     *         Callable by the depositor or the beneficiary.
     */
    function dispute(bytes32 escrowId) external whenNotPaused {
        EscrowRecord storage e = _getEscrow(escrowId);
        if (e.status != EscrowStatus.Active) revert InvalidStatus(e.status, EscrowStatus.Active);
        if (msg.sender != e.depositor && msg.sender != e.beneficiary) revert NotAuthorized();

        e.status = EscrowStatus.Disputed;

        emit EscrowDisputed(escrowId, msg.sender);
    }

    /**
     * @notice Resolve a disputed escrow — only callable by the arbiter.
     * @param releaseToBeneficiary If true → release to beneficiary, else → refund to depositor.
     */
    function resolve(
        bytes32 escrowId,
        bool releaseToBeneficiary
    ) external whenNotPaused nonReentrant {
        EscrowRecord storage e = _getEscrow(escrowId);
        if (e.status != EscrowStatus.Disputed) revert InvalidStatus(e.status, EscrowStatus.Disputed);
        if (msg.sender != e.arbiter) revert NotAuthorized();

        if (releaseToBeneficiary) {
            e.status = EscrowStatus.Released;
            token.safeTransfer(e.beneficiary, e.amount);
        } else {
            e.status = EscrowStatus.Refunded;
            token.safeTransfer(e.depositor, e.amount);
        }

        emit EscrowResolved(escrowId, msg.sender, releaseToBeneficiary);
    }

    // ─── View helpers ────────────────────────────────────────────────

    /**
     * @notice Get full escrow details.
     */
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
        )
    {
        EscrowRecord storage e = escrows[escrowId];
        return (e.depositor, e.beneficiary, e.arbiter, e.amount, e.createdAt, e.expiresAt, e.status);
    }

    /**
     * @notice Preview fee for a given amount and holding period.
     */
    function calculateFee(uint256 amount, uint256 holdingDays) external view returns (uint256) {
        return _calculateFee(amount, holdingDays);
    }

    // ─── Admin ───────────────────────────────────────────────────────

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @notice Update fee parameters. Phase 2 will move this to ParamRegistry.
     */
    function setFeeParams(
        uint256 baseRate_,
        uint256 holdingRate_,
        uint256 minEscrowFee_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        baseRate = baseRate_;
        holdingRate = holdingRate_;
        minEscrowFee = minEscrowFee_;
    }

    /**
     * @notice Update treasury address.
     */
    function setTreasury(address treasuryAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasuryAddress == address(0)) revert InvalidAddress();
        treasury = treasuryAddress;
    }

    // ─── Internal ────────────────────────────────────────────────────

    /**
     * @dev fee = max(minEscrowFee, ceil(amount * baseRate / 10000 + amount * holdingRate * days / 10000))
     */
    function _calculateFee(uint256 amount, uint256 holdingDays) internal view returns (uint256) {
        // ceil division helper: (a + b - 1) / b
        uint256 baseFee = _ceilDiv(amount * baseRate, 10000);
        uint256 holdFee = _ceilDiv(amount * holdingRate * holdingDays, 10000);
        uint256 totalFee = baseFee + holdFee;
        return totalFee < minEscrowFee ? minEscrowFee : totalFee;
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0) return 0;
        return (a + b - 1) / b;
    }

    function _getEscrow(bytes32 escrowId) internal view returns (EscrowRecord storage) {
        EscrowRecord storage e = escrows[escrowId];
        if (e.depositor == address(0)) revert EscrowNotFound(escrowId);
        return e;
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {} // solhint-disable-line no-empty-blocks
}
