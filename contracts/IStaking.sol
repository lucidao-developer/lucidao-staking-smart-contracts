// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/* 
   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

/**
 * @title Staking Interface for ERC20 Tokens
 * @notice This interface defines the functions and events for a staking contract.
 *
 * @author thirdweb (original authors of the base contract)
 * @author Lucidao (modifications and extensions)
 *
 * @dev It is licensed under the Apache-2.0 license.
 *      See the original interface for more details: https://github.com/thirdweb-dev/contracts
 */
interface IStaking {
    /// @dev Information about the staker's current stake status.
    /// @param timeOfLastUpdate The timestamp when rewards were last updated for the staker.
    /// @param timeOfLastBoostUpdate The timestamp of the last boost update, affecting reward calculations.
    /// @param conditionIdOfLastUpdate The ID of the condition under which the last update was made.
    /// @param amountStaked The total number of tokens currently staked by the user.
    /// @param unclaimedRewards The total rewards accumulated but not yet claimed by the staker.
    struct Staker {
        uint128 timeOfLastUpdate;
        uint128 timeOfLastBoostUpdate;
        uint64 conditionIdOfLastUpdate;
        uint256 amountStaked;
        uint256 unclaimedRewards;
    }

    /// @dev Represents the staking conditions at any given time.
    /// @param rewardRatioNumerator The numerator for calculating the reward rate per time unit.
    /// @param startTimestamp The start timestamp of this staking condition.
    /// @param endTimestamp The end timestamp of this staking condition, after which new conditions may apply.
    struct StakingCondition {
        uint80 startTimestamp;
        uint80 endTimestamp;
        uint256 rewardRatioNumerator;
    }

    /// @dev Represents the tiered reward structure, determining reward multipliers based on staking duration.
    /// @param minStakingDuration The minimum duration, in seconds, a user must stake to qualify for this tier.
    /// @param multiplier The reward multiplier associated with this tier. Multiplies the base reward rate.
    struct Tier {
        uint256 minStakingDuration;
        uint256 multiplier;
    }

    /// @dev Emitted when tokens are staked.
    /// @param staker The address of the user staking tokens.
    /// @param amount The amount of tokens staked.
    event TokensStaked(address indexed staker, uint256 amount);

    /// @dev Emitted when tokens are withdrawn.
    /// @param staker The address of the user withdrawing tokens.
    /// @param amount The amount of tokens withdrawn.
    event TokensWithdrawn(address indexed staker, uint256 amount);

    /// @dev Emitted when a staker claims staking rewards.
    /// @param staker The address of the staker claiming rewards.
    /// @param rewardAmount The amount of rewards claimed.
    event RewardsClaimed(address indexed staker, uint256 rewardAmount);

    /// @dev Emitted when the reward ratio is updated by the contract admin.
    /// @param oldNumerator Previous reward ratio numerator.
    /// @param newNumerator Updated reward ratio numerator.
    event UpdatedRewardRatio(uint256 oldNumerator, uint256 newNumerator);

    /// @dev Emitted when excess tokens are withdrawn by the contract admin.
    /// @param tokenAddress The address of the token being withdrawn.
    /// @param amount The amount of tokens withdrawn.
    event ExcessTokensWithdrawn(address tokenAddress, uint256 amount);

    /// @dev Emitted during an emergency withdrawal.
    /// @param withdrawer The address performing the withdrawal.
    /// @param amount The amount of tokens withdrawn in the emergency.
    event EmergencyWithdraw(address withdrawer, uint256 amount);

    /// @dev Emitted when new staking tiers are set by the contract admin.
    /// @param newTiers The new set of staking tiers.
    event TiersSet(Tier[] newTiers);

    /// @dev Emitted when the staking token cap is updated by the contract admin.
    /// @param stakingTokenCapSet The new cap on staking tokens.
    event StakingTokenCapSet(uint256 stakingTokenCapSet);

    /// @dev Emitted when the minimum amount of staked tokens to start the boost is updated by the contract admin.
    /// @param minStakingBoostAmount The new minimum amount of staked tokens to start the boost.
    event MinStakingBoostAmountSet(uint256 minStakingBoostAmount);

    /// @dev Thrown when the token address provided is invalid.
    error InvalidTokenAddress();

    /// @dev Thrown when an invalid reward ratio is set.
    error InvalidRewardRatio();

    /// @dev Thrown when the staked amount is invalid (e.g., zero).
    error InvalidAmount();

    /// @dev Thrown when no rewards are available to claim.
    error NoRewards();

    /// @dev Thrown when the withdrawal amount exceeds available tokens.
    error WithdrawAmountExceedsLimit();

    /// @dev Thrown when there are no excess staking tokens to withdraw.
    error NoExcessStakingToken();

    /// @dev Thrown when the tiers array lengths do not match or are zero.
    error InvalidTiersLength();

    /// @dev Thrown when tier durations are not in a proper ascending order.
    error InvalidTiersDurations();

    /// @dev Thrown when the staking amount exceeds the specified cap.
    error CannotStakeMoreThanCap();

    /// @dev Thrown when there are insufficient rewards in the contract to fulfill a claim.
    error MissingRewards();

    /// @dev Allows a user to stake a specified amount of tokens.
    /// @param amount The amount of tokens to stake.
    function stake(uint256 amount) external;

    /// @dev Allows a user to withdraw a specified amount of their staked tokens.
    /// @param amount The amount of tokens to withdraw.
    function withdraw(uint256 amount) external;

    /// @dev Allows a user to claim their accumulated staking rewards.
    function claimRewards() external;

    /// @dev Provides the total amount staked and the accumulated rewards for a specific staker.
    /// @param staker The address of the staker to query.
    /// @return _tokensStaked The total amount of tokens staked by the user.
    /// @return _rewards The total rewards accumulated by the user.
    function getStakeInfo(address staker) external view returns (uint256 _tokensStaked, uint256 _rewards);
}
