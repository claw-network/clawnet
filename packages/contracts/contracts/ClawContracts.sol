// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ClawContracts
 * @notice Service contracts with milestone-based payments, disputes, and arbitration.
 *         State machine: Draft → Signed → Active → Completed | Disputed | Terminated.
 *         Funds are held in this contract and released per-milestone to the provider.
 * @dev UUPS upgradeable. Uses SafeERC20 for token transfers.
 *      Platform fee = (totalAmount × platformFeeBps) / 10 000, charged on activation.
 *
 *      Future integration path: milestone payments can be routed through ClawEscrow
 *      once partial-release support is added (CONTRACTS_ROLE + partialRelease).
 */
contract ClawContracts is
    AccessControlUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    // ─── Roles ───────────────────────────────────────────────────────

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");

    // ─── Enums ───────────────────────────────────────────────────────

    enum ContractStatus {
        Draft,       // 0 — created, awaiting signatures
        Signed,      // 1 — both parties signed, awaiting funding
        Active,      // 2 — funded and executing milestones
        Completed,   // 3 — all milestones approved
        Disputed,    // 4 — dispute raised
        Terminated,  // 5 — terminated (post-funding)
        Cancelled    // 6 — cancelled (pre-funding)
    }

    enum MilestoneStatus {
        Pending,   // 0 — not yet submitted
        Submitted, // 1 — provider submitted deliverable
        Approved,  // 2 — client/arbiter approved, funds released
        Rejected   // 3 — rejected, provider may resubmit
    }

    enum DisputeResolution {
        FavorProvider, // release remaining → Completed
        FavorClient,   // refund remaining → Terminated
        Resume         // return to Active, continue milestones
    }

    // ─── Structs ─────────────────────────────────────────────────────

    /**
     * @dev Storage-packed layout (8 slots):
     *  slot 1: client (address 20 bytes)
     *  slot 2: provider (address 20 bytes)
     *  slot 3: arbiter (address 20 bytes)
     *  slot 4: totalAmount (uint256)
     *  slot 5: fundedAmount (uint256)
     *  slot 6: releasedAmount (uint256)
     *  slot 7: termsHash (bytes32)
     *  slot 8: milestoneCount(1) + status(1) + createdAt(8) + deadline(8) +
     *          clientSigned(1) + providerSigned(1) = 20 bytes
     */
    struct ServiceContract {
        address client;
        address provider;
        address arbiter;
        uint256 totalAmount;
        uint256 fundedAmount;
        uint256 releasedAmount;
        bytes32 termsHash;
        uint8 milestoneCount;
        ContractStatus status;
        uint64 createdAt;
        uint64 deadline;
        bool clientSigned;
        bool providerSigned;
    }

    struct Milestone {
        uint256 amount;
        bytes32 deliverableHash;
        MilestoneStatus status;
        uint64 deadline;
    }

    // ─── State ───────────────────────────────────────────────────────

    IERC20 public token;
    address public treasury;

    /// @notice Platform fee in basis points (e.g. 100 = 1 %).
    uint256 public platformFeeBps;

    /// @notice contractId → ServiceContract
    mapping(bytes32 => ServiceContract) internal _contracts;
    /// @notice contractId → Milestone[]
    mapping(bytes32 => Milestone[]) internal _milestones;

    // ─── Events ──────────────────────────────────────────────────────

    event ContractCreated(
        bytes32 indexed contractId,
        address indexed client,
        address indexed provider,
        uint256 totalAmount,
        uint8 milestoneCount
    );
    event ContractSigned(bytes32 indexed contractId, address indexed signer);
    event ContractActivated(
        bytes32 indexed contractId,
        uint256 fundedAmount,
        uint256 fee
    );
    event MilestoneSubmitted(
        bytes32 indexed contractId,
        uint8 indexed index,
        bytes32 deliverableHash
    );
    event MilestoneApproved(
        bytes32 indexed contractId,
        uint8 indexed index,
        uint256 amount
    );
    event MilestoneRejected(
        bytes32 indexed contractId,
        uint8 indexed index,
        bytes32 reasonHash
    );
    event ContractCompleted(bytes32 indexed contractId, uint256 totalReleased);
    event ContractDisputed(
        bytes32 indexed contractId,
        address indexed disputedBy,
        bytes32 evidenceHash
    );
    event DisputeResolved(
        bytes32 indexed contractId,
        address indexed resolver,
        DisputeResolution resolution
    );
    event ContractTerminated(
        bytes32 indexed contractId,
        address indexed terminatedBy,
        bytes32 reason
    );
    event ContractCancelled(
        bytes32 indexed contractId,
        address indexed cancelledBy
    );

    // ─── Errors ──────────────────────────────────────────────────────

    error ContractAlreadyExists(bytes32 contractId);
    error ContractNotFound(bytes32 contractId);
    error InvalidAddress();
    error InvalidAmount();
    error InvalidMilestones();
    error InvalidDeadline();
    error NotAuthorized();
    error InvalidStatus(ContractStatus current, ContractStatus expected);
    error MilestoneOutOfBounds(uint8 index, uint8 count);
    error InvalidMilestoneStatus(
        MilestoneStatus current,
        MilestoneStatus expected
    );
    error NotAllMilestonesApproved();
    error AlreadySigned();
    error DeadlineExpired();

    // ─── Initializer ─────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @param tokenAddress    ClawToken ERC-20 address.
     * @param treasuryAddress Address that collects platform fees.
     * @param feeBps          Platform fee in basis points (e.g. 100 = 1 %).
     * @param admin           DEFAULT_ADMIN, PAUSER, initial ARBITER.
     */
    function initialize(
        address tokenAddress,
        address treasuryAddress,
        uint256 feeBps,
        address admin
    ) public initializer {
        if (tokenAddress == address(0)) revert InvalidAddress();
        if (treasuryAddress == address(0)) revert InvalidAddress();
        if (admin == address(0)) revert InvalidAddress();

        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(ARBITER_ROLE, admin);

        token = IERC20(tokenAddress);
        treasury = treasuryAddress;
        platformFeeBps = feeBps;
    }

    // ─── Core: Contract Lifecycle ────────────────────────────────────

    /**
     * @notice Create a service contract in Draft status. Caller becomes the client.
     * @param contractId         Unique identifier (typically keccak256 of off-chain terms).
     * @param provider           Service provider address (beneficiary of payments).
     * @param arbiter            Dispute arbiter for this specific contract.
     * @param totalAmount        Total Token amount the provider receives across milestones.
     * @param termsHash          Hash of the full terms document (off-chain / IPFS).
     * @param deadline           Unix timestamp — overall contract deadline.
     * @param milestoneAmounts   Amount per milestone (must sum to totalAmount).
     * @param milestoneDeadlines Deadline per milestone (ascending, each ≤ contract deadline).
     */
    function createContract(
        bytes32 contractId,
        address provider,
        address arbiter,
        uint256 totalAmount,
        bytes32 termsHash,
        uint64 deadline,
        uint256[] calldata milestoneAmounts,
        uint64[] calldata milestoneDeadlines
    ) external whenNotPaused {
        if (_contracts[contractId].client != address(0)) {
            revert ContractAlreadyExists(contractId);
        }
        if (provider == address(0) || provider == msg.sender) {
            revert InvalidAddress();
        }
        if (arbiter == address(0)) revert InvalidAddress();
        if (totalAmount == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        _validateMilestones(
            totalAmount,
            deadline,
            milestoneAmounts,
            milestoneDeadlines
        );

        _contracts[contractId] = ServiceContract({
            client: msg.sender,
            provider: provider,
            arbiter: arbiter,
            totalAmount: totalAmount,
            fundedAmount: 0,
            releasedAmount: 0,
            termsHash: termsHash,
            milestoneCount: uint8(milestoneAmounts.length),
            status: ContractStatus.Draft,
            createdAt: uint64(block.timestamp),
            deadline: deadline,
            clientSigned: false,
            providerSigned: false
        });

        for (uint256 i; i < milestoneAmounts.length; i++) {
            _milestones[contractId].push(
                Milestone({
                    amount: milestoneAmounts[i],
                    deliverableHash: bytes32(0),
                    status: MilestoneStatus.Pending,
                    deadline: milestoneDeadlines[i]
                })
            );
        }

        emit ContractCreated(
            contractId,
            msg.sender,
            provider,
            totalAmount,
            uint8(milestoneAmounts.length)
        );
    }

    /**
     * @notice Sign the contract. Both client and provider must sign.
     *         When both have signed, status transitions to Signed.
     */
    function signContract(bytes32 contractId) external whenNotPaused {
        ServiceContract storage c = _getContract(contractId);
        if (c.status != ContractStatus.Draft) {
            revert InvalidStatus(c.status, ContractStatus.Draft);
        }

        if (msg.sender == c.client) {
            if (c.clientSigned) revert AlreadySigned();
            c.clientSigned = true;
        } else if (msg.sender == c.provider) {
            if (c.providerSigned) revert AlreadySigned();
            c.providerSigned = true;
        } else {
            revert NotAuthorized();
        }

        emit ContractSigned(contractId, msg.sender);

        if (c.clientSigned && c.providerSigned) {
            c.status = ContractStatus.Signed;
        }
    }

    /**
     * @notice Fund and activate the contract. Only callable by the client.
     *         Client must have approved (totalAmount + fee) Tokens.
     *         Fee = totalAmount × platformFeeBps / 10 000.
     */
    function activateContract(
        bytes32 contractId
    ) external whenNotPaused nonReentrant {
        ServiceContract storage c = _getContract(contractId);
        if (c.status != ContractStatus.Signed) {
            revert InvalidStatus(c.status, ContractStatus.Signed);
        }
        if (msg.sender != c.client) revert NotAuthorized();
        if (block.timestamp >= c.deadline) revert DeadlineExpired();

        uint256 fee = _calculateFee(c.totalAmount);
        uint256 totalRequired = c.totalAmount + fee;

        token.safeTransferFrom(msg.sender, address(this), totalRequired);

        if (fee > 0) {
            token.safeTransfer(treasury, fee);
        }

        c.fundedAmount = c.totalAmount;
        c.status = ContractStatus.Active;

        emit ContractActivated(contractId, c.totalAmount, fee);
    }

    // ─── Core: Milestones ────────────────────────────────────────────

    /**
     * @notice Submit a milestone deliverable. Only callable by the provider.
     *         May submit for Pending or Rejected milestones (re-submit after rejection).
     */
    function submitMilestone(
        bytes32 contractId,
        uint8 index,
        bytes32 deliverableHash
    ) external whenNotPaused {
        ServiceContract storage c = _getContract(contractId);
        if (c.status != ContractStatus.Active) {
            revert InvalidStatus(c.status, ContractStatus.Active);
        }
        if (msg.sender != c.provider) revert NotAuthorized();

        Milestone storage m = _getMilestone(contractId, index);
        if (
            m.status != MilestoneStatus.Pending &&
            m.status != MilestoneStatus.Rejected
        ) {
            revert InvalidMilestoneStatus(m.status, MilestoneStatus.Pending);
        }

        m.status = MilestoneStatus.Submitted;
        m.deliverableHash = deliverableHash;

        emit MilestoneSubmitted(contractId, index, deliverableHash);
    }

    /**
     * @notice Approve a submitted milestone, releasing its payment to the provider.
     *         Callable by the contract's arbiter, the client, or a global ARBITER_ROLE.
     */
    function approveMilestone(
        bytes32 contractId,
        uint8 index
    ) external whenNotPaused nonReentrant {
        ServiceContract storage c = _getContract(contractId);
        if (c.status != ContractStatus.Active) {
            revert InvalidStatus(c.status, ContractStatus.Active);
        }
        if (!_isClientOrArbiter(c)) revert NotAuthorized();

        Milestone storage m = _getMilestone(contractId, index);
        if (m.status != MilestoneStatus.Submitted) {
            revert InvalidMilestoneStatus(
                m.status,
                MilestoneStatus.Submitted
            );
        }

        m.status = MilestoneStatus.Approved;
        c.releasedAmount += m.amount;

        token.safeTransfer(c.provider, m.amount);

        emit MilestoneApproved(contractId, index, m.amount);
    }

    /**
     * @notice Reject a submitted milestone. Provider may re-submit.
     *         Callable by the contract's arbiter, the client, or a global ARBITER_ROLE.
     */
    function rejectMilestone(
        bytes32 contractId,
        uint8 index,
        bytes32 reasonHash
    ) external whenNotPaused {
        ServiceContract storage c = _getContract(contractId);
        if (c.status != ContractStatus.Active) {
            revert InvalidStatus(c.status, ContractStatus.Active);
        }
        if (!_isClientOrArbiter(c)) revert NotAuthorized();

        Milestone storage m = _getMilestone(contractId, index);
        if (m.status != MilestoneStatus.Submitted) {
            revert InvalidMilestoneStatus(
                m.status,
                MilestoneStatus.Submitted
            );
        }

        m.status = MilestoneStatus.Rejected;

        emit MilestoneRejected(contractId, index, reasonHash);
    }

    /**
     * @notice Mark the contract as Completed. Callable by client or provider
     *         once ALL milestones have been approved.
     */
    function completeContract(bytes32 contractId) external whenNotPaused {
        ServiceContract storage c = _getContract(contractId);
        if (c.status != ContractStatus.Active) {
            revert InvalidStatus(c.status, ContractStatus.Active);
        }
        if (msg.sender != c.client && msg.sender != c.provider) {
            revert NotAuthorized();
        }

        Milestone[] storage ms = _milestones[contractId];
        for (uint256 i; i < ms.length; i++) {
            if (ms[i].status != MilestoneStatus.Approved) {
                revert NotAllMilestonesApproved();
            }
        }

        c.status = ContractStatus.Completed;

        emit ContractCompleted(contractId, c.releasedAmount);
    }

    // ─── Core: Disputes ──────────────────────────────────────────────

    /**
     * @notice Raise a dispute. Callable by either party while Active.
     * @param evidenceHash Hash of submitted evidence (stored off-chain).
     */
    function disputeContract(
        bytes32 contractId,
        bytes32 evidenceHash
    ) external whenNotPaused {
        ServiceContract storage c = _getContract(contractId);
        if (c.status != ContractStatus.Active) {
            revert InvalidStatus(c.status, ContractStatus.Active);
        }
        if (msg.sender != c.client && msg.sender != c.provider) {
            revert NotAuthorized();
        }

        c.status = ContractStatus.Disputed;

        emit ContractDisputed(contractId, msg.sender, evidenceHash);
    }

    /**
     * @notice Resolve a dispute. Only the contract arbiter or a global ARBITER_ROLE.
     * @param resolution FavorProvider → release remaining → Completed,
     *                   FavorClient  → refund remaining → Terminated,
     *                   Resume       → return to Active.
     */
    function resolveDispute(
        bytes32 contractId,
        DisputeResolution resolution
    ) external whenNotPaused nonReentrant {
        ServiceContract storage c = _getContract(contractId);
        if (c.status != ContractStatus.Disputed) {
            revert InvalidStatus(c.status, ContractStatus.Disputed);
        }
        if (msg.sender != c.arbiter && !hasRole(ARBITER_ROLE, msg.sender)) {
            revert NotAuthorized();
        }

        if (resolution == DisputeResolution.FavorProvider) {
            _releaseRemaining(c);
            c.status = ContractStatus.Completed;
        } else if (resolution == DisputeResolution.FavorClient) {
            _refundRemaining(c);
            c.status = ContractStatus.Terminated;
        } else {
            // Resume — return to Active
            c.status = ContractStatus.Active;
        }

        emit DisputeResolved(contractId, msg.sender, resolution);
    }

    // ─── Core: Termination / Cancellation ────────────────────────────

    /**
     * @notice Terminate an Active or Disputed contract. Remaining funds refunded.
     *         Callable by client, provider, contract arbiter, admin, or global ARBITER_ROLE.
     *         Also allows timeout termination: anyone can call after deadline.
     */
    function terminateContract(
        bytes32 contractId,
        bytes32 reason
    ) external whenNotPaused nonReentrant {
        ServiceContract storage c = _getContract(contractId);

        bool isTerminable = c.status == ContractStatus.Active ||
            c.status == ContractStatus.Disputed;
        if (!isTerminable) {
            revert InvalidStatus(c.status, ContractStatus.Active);
        }

        bool isTimeout = block.timestamp >= c.deadline;
        bool isAuthorized = msg.sender == c.client ||
            msg.sender == c.provider ||
            msg.sender == c.arbiter ||
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender) ||
            hasRole(ARBITER_ROLE, msg.sender);

        if (!isTimeout && !isAuthorized) revert NotAuthorized();

        _refundRemaining(c);
        c.status = ContractStatus.Terminated;

        emit ContractTerminated(contractId, msg.sender, reason);
    }

    /**
     * @notice Cancel a pre-funded contract (Draft or Signed). No funds involved.
     *         Callable by client or provider.
     */
    function cancelContract(bytes32 contractId) external whenNotPaused {
        ServiceContract storage c = _getContract(contractId);

        bool isCancellable = c.status == ContractStatus.Draft ||
            c.status == ContractStatus.Signed;
        if (!isCancellable) {
            revert InvalidStatus(c.status, ContractStatus.Draft);
        }
        if (msg.sender != c.client && msg.sender != c.provider) {
            revert NotAuthorized();
        }

        c.status = ContractStatus.Cancelled;

        emit ContractCancelled(contractId, msg.sender);
    }

    // ─── View ────────────────────────────────────────────────────────

    function getContract(
        bytes32 contractId
    ) external view returns (ServiceContract memory) {
        ServiceContract storage c = _contracts[contractId];
        if (c.client == address(0)) revert ContractNotFound(contractId);
        return c;
    }

    function getMilestone(
        bytes32 contractId,
        uint8 index
    ) external view returns (Milestone memory) {
        _getContract(contractId);
        if (index >= _contracts[contractId].milestoneCount) {
            revert MilestoneOutOfBounds(
                index,
                _contracts[contractId].milestoneCount
            );
        }
        return _milestones[contractId][index];
    }

    function getMilestones(
        bytes32 contractId
    ) external view returns (Milestone[] memory) {
        _getContract(contractId);
        return _milestones[contractId];
    }

    function calculateFee(uint256 amount) external view returns (uint256) {
        return _calculateFee(amount);
    }

    // ─── Admin ───────────────────────────────────────────────────────

    function setPlatformFeeBps(
        uint256 feeBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        platformFeeBps = feeBps;
    }

    function setTreasury(
        address treasuryAddress
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasuryAddress == address(0)) revert InvalidAddress();
        treasury = treasuryAddress;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ─── Internal ────────────────────────────────────────────────────

    function _validateMilestones(
        uint256 totalAmount,
        uint64 deadline,
        uint256[] calldata amounts,
        uint64[] calldata deadlines
    ) internal pure {
        uint256 len = amounts.length;
        if (len == 0 || len != deadlines.length || len > 255) {
            revert InvalidMilestones();
        }

        uint256 sum;
        for (uint256 i; i < len; i++) {
            if (amounts[i] == 0) revert InvalidAmount();
            if (deadlines[i] > deadline) revert InvalidDeadline();
            if (i > 0 && deadlines[i] < deadlines[i - 1]) {
                revert InvalidDeadline();
            }
            sum += amounts[i];
        }

        if (sum != totalAmount) revert InvalidMilestones();
    }

    function _calculateFee(uint256 amount) internal view returns (uint256) {
        return (amount * platformFeeBps) / 10000;
    }

    function _isClientOrArbiter(
        ServiceContract storage c
    ) internal view returns (bool) {
        return
            msg.sender == c.client ||
            msg.sender == c.arbiter ||
            hasRole(ARBITER_ROLE, msg.sender);
    }

    function _releaseRemaining(ServiceContract storage c) internal {
        uint256 remaining = c.fundedAmount - c.releasedAmount;
        if (remaining > 0) {
            c.releasedAmount = c.fundedAmount;
            token.safeTransfer(c.provider, remaining);
        }
    }

    function _refundRemaining(ServiceContract storage c) internal {
        uint256 remaining = c.fundedAmount - c.releasedAmount;
        if (remaining > 0) {
            c.releasedAmount = c.fundedAmount;
            token.safeTransfer(c.client, remaining);
        }
    }

    function _getContract(
        bytes32 contractId
    ) internal view returns (ServiceContract storage) {
        ServiceContract storage c = _contracts[contractId];
        if (c.client == address(0)) revert ContractNotFound(contractId);
        return c;
    }

    function _getMilestone(
        bytes32 contractId,
        uint8 index
    ) internal view returns (Milestone storage) {
        if (index >= _contracts[contractId].milestoneCount) {
            revert MilestoneOutOfBounds(
                index,
                _contracts[contractId].milestoneCount
            );
        }
        return _milestones[contractId][index];
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {} // solhint-disable-line no-empty-blocks
}
