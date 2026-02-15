// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICommitteeEligibility
 * @notice Interface for committee member eligibility verification
 * @dev Implementations can define various rules (whitelist, staking, DAO vote, etc.)
 */
interface ICommitteeEligibility {
    /**
     * @notice Check if an address is eligible to be a committee member
     * @param candidate Address to check
     * @return true if eligible, false otherwise
     */
    function isEligible(address candidate) external view returns (bool);

    /**
     * @notice Get human-readable requirements description
     * @return Description of eligibility requirements
     */
    function getRequirements() external view returns (string memory);
}
