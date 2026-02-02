// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/ICommitteeEligibility.sol";

/**
 * @title WhitelistEligibility
 * @notice Whitelist-based eligibility for committee members
 * @dev Owner can add/remove addresses from whitelist
 */
contract WhitelistEligibility is ICommitteeEligibility {
    mapping(address => bool) public whitelist;
    address public owner;

    event AddedToWhitelist(address indexed account);
    event RemovedFromWhitelist(address indexed account);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error AlreadyWhitelisted();
    error NotWhitelisted();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address[] memory initialWhitelist) {
        owner = msg.sender;
        for (uint256 i = 0; i < initialWhitelist.length; i++) {
            whitelist[initialWhitelist[i]] = true;
            emit AddedToWhitelist(initialWhitelist[i]);
        }
    }

    /**
     * @notice Check if address is whitelisted
     */
    function isEligible(address candidate) external view override returns (bool) {
        return whitelist[candidate];
    }

    /**
     * @notice Get requirements description
     */
    function getRequirements() external pure override returns (string memory) {
        return "Must be whitelisted by owner";
    }

    /**
     * @notice Add address to whitelist
     */
    function addToWhitelist(address account) external onlyOwner {
        if (whitelist[account]) revert AlreadyWhitelisted();
        whitelist[account] = true;
        emit AddedToWhitelist(account);
    }

    /**
     * @notice Remove address from whitelist
     */
    function removeFromWhitelist(address account) external onlyOwner {
        if (!whitelist[account]) revert NotWhitelisted();
        whitelist[account] = false;
        emit RemovedFromWhitelist(account);
    }

    /**
     * @notice Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}
