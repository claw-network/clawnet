// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockClawRouter {
    mapping(bytes32 => address) private modules;

    event ModuleRegistered(bytes32 indexed key, address indexed module);

    function registerModule(bytes32 key, address addr) external {
        modules[key] = addr;
        emit ModuleRegistered(key, addr);
    }

    function getModuleOrZero(bytes32 key) external view returns (address) {
        return modules[key];
    }
}
