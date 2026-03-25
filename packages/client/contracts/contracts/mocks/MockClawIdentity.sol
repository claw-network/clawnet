// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockClawIdentity {
    mapping(bytes32 => bool) public active;
    mapping(bytes32 => address) public controller;

    function setDid(bytes32 didHash, address didController, bool activeFlag) external {
        controller[didHash] = didController;
        active[didHash] = activeFlag;
    }

    function isActive(bytes32 didHash) external view returns (bool) {
        return active[didHash];
    }

    function getController(bytes32 didHash) external view returns (address) {
        return controller[didHash];
    }
}
