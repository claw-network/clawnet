// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import "./interfaces/IClawIdentity.sol";

contract TelagentGroupRegistry is AccessControlUpgradeable, UUPSUpgradeable, PausableUpgradeable {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    enum MembershipState {
        None,
        Pending,
        Finalized,
        Removed
    }

    struct GroupRecord {
        bytes32 creatorDidHash;
        string groupDomain;
        bytes32 domainProofHash;
        bytes32 mlsStateHash;
        uint64 createdAt;
        uint64 updatedAt;
        bool active;
    }

    struct InviteRecord {
        bytes32 inviterDidHash;
        bytes32 inviteeDidHash;
        bool exists;
        bool accepted;
    }

    IClawIdentity public identity;

    mapping(bytes32 => GroupRecord) public groups;
    mapping(bytes32 => mapping(bytes32 => MembershipState)) public members;
    mapping(bytes32 => mapping(bytes32 => InviteRecord)) public invites;

    event GroupCreated(
        bytes32 indexed groupId,
        bytes32 indexed creatorDidHash,
        bytes32 indexed domainHash,
        bytes32 domainProofHash,
        uint256 blockNumber
    );

    event MemberInvited(
        bytes32 indexed groupId,
        bytes32 indexed inviteId,
        bytes32 indexed inviterDidHash,
        bytes32 inviteeDidHash,
        bytes32 mlsCommitHash
    );

    event MemberAccepted(
        bytes32 indexed groupId,
        bytes32 indexed inviteId,
        bytes32 indexed memberDidHash,
        bytes32 mlsWelcomeHash
    );

    event MemberRemoved(
        bytes32 indexed groupId,
        bytes32 indexed memberDidHash,
        bytes32 indexed operatorDidHash,
        bytes32 mlsCommitHash
    );

    error ZeroAddress();
    error EmptyDomain();
    error InvalidHash();
    error GroupAlreadyExists(bytes32 groupId);
    error GroupNotFound(bytes32 groupId);
    error GroupInactive(bytes32 groupId);
    error DidNotActive(bytes32 didHash);
    error NotDidController(bytes32 didHash, address caller);
    error NotGroupOwner(bytes32 groupId, bytes32 operatorDidHash);
    error InviteAlreadyExists(bytes32 groupId, bytes32 inviteId);
    error InviteNotFound(bytes32 groupId, bytes32 inviteId);
    error InviteAlreadyAccepted(bytes32 groupId, bytes32 inviteId);
    error InviteeMismatch(bytes32 expected, bytes32 actual);
    error InvalidMemberState(bytes32 groupId, bytes32 memberDidHash);
    error CannotRemoveOwner(bytes32 groupId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address identityAddress) public initializer {
        if (admin == address(0) || identityAddress == address(0)) {
            revert ZeroAddress();
        }

        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);

        identity = IClawIdentity(identityAddress);
    }

    function createGroup(
        bytes32 groupId,
        bytes32 creatorDidHash,
        string calldata groupDomain,
        bytes32 domainProofHash,
        bytes32 initialMlsStateHash
    ) external whenNotPaused {
        if (groups[groupId].createdAt != 0) {
            revert GroupAlreadyExists(groupId);
        }
        if (bytes(groupDomain).length == 0) {
            revert EmptyDomain();
        }
        if (domainProofHash == bytes32(0) || initialMlsStateHash == bytes32(0)) {
            revert InvalidHash();
        }

        _assertDidController(creatorDidHash);

        groups[groupId] = GroupRecord({
            creatorDidHash: creatorDidHash,
            groupDomain: groupDomain,
            domainProofHash: domainProofHash,
            mlsStateHash: initialMlsStateHash,
            createdAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp),
            active: true
        });

        members[groupId][creatorDidHash] = MembershipState.Finalized;

        emit GroupCreated(
            groupId,
            creatorDidHash,
            keccak256(bytes(groupDomain)),
            domainProofHash,
            block.number
        );
    }

    function inviteMember(
        bytes32 groupId,
        bytes32 inviteId,
        bytes32 inviterDidHash,
        bytes32 inviteeDidHash,
        bytes32 mlsCommitHash
    ) external whenNotPaused {
        GroupRecord storage group = groups[groupId];
        if (group.createdAt == 0) {
            revert GroupNotFound(groupId);
        }
        if (!group.active) {
            revert GroupInactive(groupId);
        }
        if (mlsCommitHash == bytes32(0)) {
            revert InvalidHash();
        }
        if (invites[groupId][inviteId].exists) {
            revert InviteAlreadyExists(groupId, inviteId);
        }

        _assertDidController(inviterDidHash);
        if (group.creatorDidHash != inviterDidHash) {
            revert NotGroupOwner(groupId, inviterDidHash);
        }
        _assertDidActive(inviteeDidHash);

        invites[groupId][inviteId] = InviteRecord({
            inviterDidHash: inviterDidHash,
            inviteeDidHash: inviteeDidHash,
            exists: true,
            accepted: false
        });

        members[groupId][inviteeDidHash] = MembershipState.Pending;
        group.mlsStateHash = mlsCommitHash;
        group.updatedAt = uint64(block.timestamp);

        emit MemberInvited(groupId, inviteId, inviterDidHash, inviteeDidHash, mlsCommitHash);
    }

    function acceptInvite(
        bytes32 groupId,
        bytes32 inviteId,
        bytes32 inviteeDidHash,
        bytes32 mlsWelcomeHash
    ) external whenNotPaused {
        GroupRecord storage group = groups[groupId];
        if (group.createdAt == 0) {
            revert GroupNotFound(groupId);
        }
        if (!group.active) {
            revert GroupInactive(groupId);
        }
        if (mlsWelcomeHash == bytes32(0)) {
            revert InvalidHash();
        }

        InviteRecord storage invite = invites[groupId][inviteId];
        if (!invite.exists) {
            revert InviteNotFound(groupId, inviteId);
        }
        if (invite.accepted) {
            revert InviteAlreadyAccepted(groupId, inviteId);
        }
        if (invite.inviteeDidHash != inviteeDidHash) {
            revert InviteeMismatch(invite.inviteeDidHash, inviteeDidHash);
        }

        _assertDidController(inviteeDidHash);

        invite.accepted = true;
        members[groupId][inviteeDidHash] = MembershipState.Finalized;
        group.mlsStateHash = mlsWelcomeHash;
        group.updatedAt = uint64(block.timestamp);

        emit MemberAccepted(groupId, inviteId, inviteeDidHash, mlsWelcomeHash);
    }

    function removeMember(
        bytes32 groupId,
        bytes32 operatorDidHash,
        bytes32 memberDidHash,
        bytes32 mlsCommitHash
    ) external whenNotPaused {
        GroupRecord storage group = groups[groupId];
        if (group.createdAt == 0) {
            revert GroupNotFound(groupId);
        }
        if (!group.active) {
            revert GroupInactive(groupId);
        }
        if (mlsCommitHash == bytes32(0)) {
            revert InvalidHash();
        }

        _assertDidController(operatorDidHash);
        if (group.creatorDidHash != operatorDidHash) {
            revert NotGroupOwner(groupId, operatorDidHash);
        }
        if (group.creatorDidHash == memberDidHash) {
            revert CannotRemoveOwner(groupId);
        }

        MembershipState currentState = members[groupId][memberDidHash];
        if (currentState != MembershipState.Pending && currentState != MembershipState.Finalized) {
            revert InvalidMemberState(groupId, memberDidHash);
        }

        members[groupId][memberDidHash] = MembershipState.Removed;
        group.mlsStateHash = mlsCommitHash;
        group.updatedAt = uint64(block.timestamp);

        emit MemberRemoved(groupId, memberDidHash, operatorDidHash, mlsCommitHash);
    }

    function getGroup(bytes32 groupId) external view returns (GroupRecord memory) {
        GroupRecord memory group = groups[groupId];
        if (group.createdAt == 0) {
            revert GroupNotFound(groupId);
        }
        return group;
    }

    function getMemberState(bytes32 groupId, bytes32 memberDidHash) external view returns (MembershipState) {
        GroupRecord memory group = groups[groupId];
        if (group.createdAt == 0) {
            revert GroupNotFound(groupId);
        }
        return members[groupId][memberDidHash];
    }

    function isFinalizedMember(bytes32 groupId, bytes32 memberDidHash) external view returns (bool) {
        return members[groupId][memberDidHash] == MembershipState.Finalized;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _assertDidController(bytes32 didHash) internal view {
        _assertDidActive(didHash);
        address controller = identity.getController(didHash);
        if (controller != msg.sender) {
            revert NotDidController(didHash, msg.sender);
        }
    }

    function _assertDidActive(bytes32 didHash) internal view {
        bool active = identity.isActive(didHash);
        if (!active) {
            revert DidNotActive(didHash);
        }
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
