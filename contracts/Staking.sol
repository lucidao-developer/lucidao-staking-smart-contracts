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

import {ReentrancyGuard} from "@openzeppelin/contracts-v5/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts-v5/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts-v5/access/Ownable.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts-v5/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts-v5/utils/Pausable.sol";
import {IStaking} from "./IStaking.sol";

/**
 * @title Staking Contract for ERC20 Tokens
 * @notice This contract allows users to stake ERC20 tokens to earn rewards based on the duration of their stake.
 * @dev The contract uses a tiered reward system where longer stakes earn higher rewards.
 *      It integrates with OpenZeppelin's security and ownership features to ensure safe operations.
 *      Features include regular staking, emergency withdrawals, and administrative adjustments to staking parameters.
 *
 * @author thirdweb (original authors of the base contract)
 * @author Lucidao (modifications and extensions)
 *
 * @dev This contract is based on the Staking20Base contract developed by thirdweb and is licensed under the Apache-2.0 license.
 *      See the original contract for more details: https://github.com/thirdweb-dev/contracts
 */
contract Staking is ReentrancyGuard, Ownable, IStaking, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant TIME_UNIT = 360 days;
    uint256 public constant REWARD_RATIO_DENOMINATOR = 10000;

    /// @dev The ERC20 token address used for staking.
    address public stakingToken;

    /// @dev Number of decimal places in the staking token.
    uint16 public stakingTokenDecimals;

    /// @dev Tracks the next condition ID for staking conditions.
    uint64 private nextConditionId;

    /// @dev Total amount of tokens currently staked in the contract.
    uint256 public stakingTokenBalance;

    /// @dev The maximum amount of tokens that can be staked in this contract.
    uint256 public stakingTokenCap;

    /// @dev The minimum amount of tokens that must be staked to receive staking boosts.
    uint256 public minStakingBoostAmount;

    /// @dev Mapping of staker addresses to their staking details.
    mapping(address => Staker) public stakers;

    /// @dev Mapping of condition IDs to their respective staking conditions.
    mapping(uint256 => StakingCondition) private stakingConditions;

    /// @dev Array of reward tiers, defining minimum staking durations and reward multipliers.
    Tier[] public tiers;

    /// @dev Sets initial contract parameters and conditions for staking.
    constructor(address _stakingToken, uint256 _rewardRatioNumerator, uint256 _stakingTokenCap, uint256 _minStakingBoostAmount) Ownable(_msgSender()) {
        if (_stakingToken == address(0)) revert InvalidTokenAddress();

        stakingToken = _stakingToken;
        stakingTokenCap = _stakingTokenCap;
        minStakingBoostAmount = _minStakingBoostAmount;

        _setStakingCondition(_rewardRatioNumerator);
    }

    /// @dev Pauses all staking and withdrawal operations.
    function pause() external onlyOwner {
        _pause();
    }

    /// @dev Resumes all staking and withdrawal operations.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @dev Allows a user to stake a specified amount of ERC20 tokens.
    /// @param _amount The amount of ERC20 tokens to stake.
    function stake(uint256 _amount) external nonReentrant whenNotPaused {
        _stake(_amount);
    }

    /// @dev Allows a user to withdraw a specified amount of their staked ERC20 tokens.
    /// @param _amount The amount of ERC20 tokens to withdraw.
    function withdraw(uint256 _amount) external nonReentrant whenNotPaused {
        _withdraw(_amount);
    }

    /// @dev Allows a user to claim all accumulated rewards.
    function claimRewards() external nonReentrant whenNotPaused {
        _claimRewards();
    }

    /// @dev Allows a user to perform an emergency withdrawal of their staked tokens without claiming rewards.
    function emergencyWithdraw() external nonReentrant {
        uint256 _amountStaked = stakers[_msgSender()].amountStaked;
        if (_amountStaked == 0) revert InvalidAmount();

        _updateUnclaimedRewardsForStaker(_msgSender());

        stakers[_msgSender()].timeOfLastBoostUpdate = uint80(block.timestamp);
        stakers[_msgSender()].amountStaked = 0;
        stakingTokenBalance -= _amountStaked;
        IERC20(stakingToken).safeTransfer(_msgSender(), _amountStaked);

        emit EmergencyWithdraw(_msgSender(), _amountStaked);
    }

    /// @dev Withdraws tokens not part of the staking pool or tokens in excess of the cap.
    /// @param tokenAddress The address of the token to withdraw.
    /// @param amount The amount of tokens to withdraw.
    function withdrawExcessTokens(address tokenAddress, uint256 amount) external onlyOwner {
        if (tokenAddress == address(0)) revert InvalidTokenAddress();
        if (amount == 0) revert InvalidAmount();

        IERC20 token = IERC20(tokenAddress);

        uint256 withdrawableAmount = token.balanceOf(address(this));
        if (tokenAddress == stakingToken) {
            if (withdrawableAmount <= stakingTokenBalance) revert NoExcessStakingToken();
            withdrawableAmount = withdrawableAmount - stakingTokenBalance;
        }

        if (amount > withdrawableAmount) revert WithdrawAmountExceedsLimit();
        token.safeTransfer(owner(), amount);
        emit ExcessTokensWithdrawn(tokenAddress, amount);
    }

    /// @dev Updates the reward ratio used in reward calculations.
    /// @param _numerator The new numerator for the reward ratio.
    function setRewardRatio(uint256 _numerator) external onlyOwner {
        StakingCondition memory condition = stakingConditions[nextConditionId - 1];
        if (_numerator == condition.rewardRatioNumerator) revert InvalidRewardRatio();
        _setStakingCondition(_numerator);

        emit UpdatedRewardRatio(condition.rewardRatioNumerator, _numerator);
    }

    /// @dev Defines new tiers for staking rewards, specifying minimum durations and reward multipliers.
    /// @param _durations Array containing the minimum durations for each tier.
    /// @param _multipliers Array containing the reward multipliers for each tier.
    function setTiers(uint256[] calldata _durations, uint256[] calldata _multipliers) external onlyOwner {
        _setTiers(_durations, _multipliers);
    }

    /// @dev Sets the maximum cap for the total amount of tokens that can be staked in this contract.
    /// @param _stakingTokenCap The new staking token cap.
    function setStakingTokenCap(uint256 _stakingTokenCap) external onlyOwner {
        _setStakingTokenCap(_stakingTokenCap);
    }

    /// @dev Sets the minimum staking amount required to start receiving boost rewards.
    /// @param _minStakingBoostAmount The minimum amount of tokens required to activate the boost.
    function setMinStakingBoostAmount(uint256 _minStakingBoostAmount) external onlyOwner {
        _setMinStakingBoostAmount(_minStakingBoostAmount);
    }

    /// @dev Retrieve staking information for a specific staker.
    /// @param _staker Address of the staker.
    /// @return _tokensStaked Amount of tokens staked by the staker.
    /// @return _rewards Rewards accumulated by the staker.
    function getStakeInfo(address _staker) external view returns (uint256 _tokensStaked, uint256 _rewards) {
        _tokensStaked = stakers[_staker].amountStaked;
        _rewards = _availableRewards(_staker);
    }

    /// @dev Calculate the current reward multiplier based on staking duration and minimum boost amount condition.
    /// @param _user Address of the user to check.
    /// @return _multiplier Current reward multiplier for the user.
    function getCurrentMultiplier(address _user) public view returns (uint256 _multiplier) {
        Staker memory staker = stakers[_user];
        uint256 timeElapsed = block.timestamp - staker.timeOfLastBoostUpdate;

        _multiplier = 100;
        if (tiers.length == 0 || staker.amountStaked < minStakingBoostAmount || staker.timeOfLastBoostUpdate == 0) {
            return _multiplier;
        }

        for (uint256 i = 0; i < tiers.length; i++) {
            if (timeElapsed < tiers[i].minStakingDuration) {
                return i == 0 ? _multiplier : tiers[i - 1].multiplier; // Return previous tier's multiplier if not enough time has elapsed for the next tier
            }
        }

        // If time elapsed surpasses all tier durations, return the multiplier of the last tier
        return tiers[tiers.length - 1].multiplier;
    }

    /// @dev Calculate the Annual Percentage Rate (APR) for staking.
    /// @return _apr Annual Percentage Rate, scaled by 1e18 to maintain precision.
    function calculateAPR() public view returns (uint256 _apr) {
        if (stakingTokenBalance == 0) return 0;
        StakingCondition memory condition = stakingConditions[nextConditionId - 1];
        _apr = (condition.rewardRatioNumerator * stakingTokenBalance) / REWARD_RATIO_DENOMINATOR;
        return _apr;
    }

    /// @dev Retrieve the current reward ratio for staking calculations.
    /// @return _numerator Reward ratio numerator.
    /// @return _denominator Reward ratio denominator.
    function getRewardRatio() public view returns (uint256 _numerator, uint256 _denominator) {
        _numerator = stakingConditions[nextConditionId - 1].rewardRatioNumerator;
        _denominator = REWARD_RATIO_DENOMINATOR;
    }

    /// @dev Staking logic handling token transfers and updates.
    /// @param _amount Amount of tokens to stake.
    function _stake(uint256 _amount) internal {
        if (_amount == 0) revert InvalidAmount();
        if (stakingTokenBalance + _amount > stakingTokenCap) revert CannotStakeMoreThanCap();

        uint256 initialAmountStaked = stakers[_msgSender()].amountStaked;

        if (initialAmountStaked < minStakingBoostAmount && initialAmountStaked + _amount >= minStakingBoostAmount) {
            stakers[_msgSender()].timeOfLastBoostUpdate = uint80(block.timestamp);
        }

        if (initialAmountStaked > 0) {
            _updateUnclaimedRewardsForStaker(_msgSender());
        } else {
            stakers[_msgSender()].timeOfLastUpdate = uint80(block.timestamp);
            stakers[_msgSender()].conditionIdOfLastUpdate = nextConditionId - 1;
        }

        uint256 balanceBefore = IERC20(stakingToken).balanceOf(address(this));
        IERC20(stakingToken).safeTransferFrom(_msgSender(), address(this), _amount);
        uint256 actualAmount = IERC20(stakingToken).balanceOf(address(this)) - balanceBefore;

        stakers[_msgSender()].amountStaked += actualAmount;
        stakingTokenBalance += actualAmount;

        emit TokensStaked(_msgSender(), actualAmount);
    }

    /// @dev Logic for withdrawing staked tokens.
    /// @param _amount Amount of tokens to withdraw.
    function _withdraw(uint256 _amount) internal {
        uint256 _amountStaked = stakers[_msgSender()].amountStaked;
        if (_amount == 0 || _amountStaked < _amount) revert InvalidAmount();

        _updateUnclaimedRewardsForStaker(_msgSender());

        stakers[_msgSender()].timeOfLastBoostUpdate = uint80(block.timestamp);
        stakers[_msgSender()].amountStaked -= _amount;
        stakingTokenBalance -= _amount;
        IERC20(stakingToken).safeTransfer(_msgSender(), _amount);

        emit TokensWithdrawn(_msgSender(), _amount);
    }

    /// @dev Logic for claiming rewards, integrating reward calculation.
    function _claimRewards() internal {
        uint256 rewards = stakers[_msgSender()].unclaimedRewards + _calculateRewards(_msgSender());

        if (rewards == 0) revert NoRewards();
        if (rewards > IERC20(stakingToken).balanceOf(address(this)) - stakingTokenBalance) revert MissingRewards();

        stakers[_msgSender()].timeOfLastUpdate = uint80(block.timestamp);
        stakers[_msgSender()].unclaimedRewards = 0;
        stakers[_msgSender()].conditionIdOfLastUpdate = nextConditionId - 1;

        _distributeRewards(_msgSender(), rewards);

        emit RewardsClaimed(_msgSender(), rewards);
    }

    /// @dev Logic for updating unclaimed rewards during state changes.
    /// @param _staker Address of the staker to update.
    function _updateUnclaimedRewardsForStaker(address _staker) internal {
        uint256 rewards = _calculateRewards(_staker);
        stakers[_staker].unclaimedRewards += rewards;
        stakers[_staker].timeOfLastUpdate = uint80(block.timestamp);
        stakers[_staker].conditionIdOfLastUpdate = nextConditionId - 1;
    }

    /// @dev Logic for setting new staking conditions.
    /// @param _numerator New reward ratio numerator.
    function _setStakingCondition(uint256 _numerator) internal {
        if (_numerator == 0) revert InvalidRewardRatio();
        uint256 conditionId = nextConditionId;
        nextConditionId += 1;

        stakingConditions[conditionId] = StakingCondition({rewardRatioNumerator: _numerator, startTimestamp: uint80(block.timestamp), endTimestamp: 0});

        if (conditionId > 0) {
            stakingConditions[conditionId - 1].endTimestamp = uint80(block.timestamp);
        }
    }

    /// @dev Logic for distributing ERC20 rewards to stakers.
    /// @param _staker Address for which to distribute rewards.
    /// @param _rewards Amount of tokens to distribute as rewards.
    function _distributeRewards(address _staker, uint256 _rewards) internal {
        IERC20(stakingToken).safeTransfer(_staker, _rewards);
    }

    /// @dev Logic for setting new reward tiers.
    /// @param _durations Array of minimum staking durations for new tiers.
    /// @param _multipliers Array of reward multipliers for new tiers.
    function _setTiers(uint256[] calldata _durations, uint256[] calldata _multipliers) internal {
        if (_durations.length != _multipliers.length || _durations.length == 0) revert InvalidTiersLength();

        while (tiers.length > 0) {
            tiers.pop();
        }

        for (uint256 i; i < _durations.length; i++) {
            if (i > 0 && _durations[i] <= _durations[i - 1]) revert InvalidTiersDurations();
            tiers.push(Tier(_durations[i], _multipliers[i]));
        }

        emit TiersSet(tiers);
    }

    /// @dev Sets the maximum number of tokens that can be staked in the contract.
    /// @param _stakingTokenCap The new cap for the maximum amount of tokens that can be staked.
    function _setStakingTokenCap(uint256 _stakingTokenCap) internal {
        stakingTokenCap = _stakingTokenCap;

        emit StakingTokenCapSet(_stakingTokenCap);
    }

    /// @dev Sets the minimum amount of tokens a user needs to stake in order to start receiving boosted rewards.
    /// @param _minStakingBoostAmount The minimum amount of staking tokens required to start receiving boost benefits.
    function _setMinStakingBoostAmount(uint256 _minStakingBoostAmount) internal {
        if (_minStakingBoostAmount == 0) revert InvalidAmount();

        minStakingBoostAmount = _minStakingBoostAmount;

        emit MinStakingBoostAmountSet(_minStakingBoostAmount);
    }

    /// @dev Logic for calculating available rewards for a staker.
    /// @param _staker Address of the staker to calculate rewards for.
    /// @return _rewards Available rewards for the staker.
    function _availableRewards(address _staker) internal view returns (uint256 _rewards) {
        if (stakers[_staker].amountStaked == 0) {
            _rewards = stakers[_staker].unclaimedRewards;
        } else {
            _rewards = stakers[_staker].unclaimedRewards + _calculateRewards(_staker);
        }
    }

    /// @dev Logic for calculating rewards based on staking conditions.
    /// @param _staker Address of the staker to calculate rewards for.
    /// @return _rewards Calculated rewards for the staker.
    function _calculateRewards(address _staker) internal view returns (uint256 _rewards) {
        Staker memory staker = stakers[_staker];

        uint256 _stakerConditionId = staker.conditionIdOfLastUpdate;
        uint256 _nextConditionId = nextConditionId;

        for (uint256 i = _stakerConditionId; i < _nextConditionId; i++) {
            StakingCondition memory condition = stakingConditions[i];

            uint256 startTime = i != _stakerConditionId ? condition.startTimestamp : staker.timeOfLastUpdate;
            uint256 endTime = condition.endTimestamp != 0 ? condition.endTimestamp : block.timestamp;

            uint256 rewardRatioNumerator = (condition.rewardRatioNumerator * getCurrentMultiplier(_staker)) / 100;

            (bool noOverflowProduct, uint256 rewardsProductPartial) = Math.tryMul((endTime - startTime), staker.amountStaked);
            (bool noOverflowProduct2, uint256 rewardsProduct) = Math.tryMul(rewardsProductPartial, rewardRatioNumerator);
            uint256 rewards = _rewards + rewardsProduct / (TIME_UNIT * REWARD_RATIO_DENOMINATOR);

            _rewards = (noOverflowProduct && noOverflowProduct2) ? rewards : _rewards;
        }
    }
}
