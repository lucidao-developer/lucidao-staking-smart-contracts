import hre from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  minStakingBoostAmount,
  ONE_DAY,
  rewardRatioDenominator,
  rewardRatioNumerator,
  stakeAmount,
  stakingTokenCap,
  tiersDurations,
  tiersMultipliers,
  timeUnit,
} from "../config/config";
import { MaxUint256, parseUnits, ZeroAddress } from "ethers";
import { calculateExpectedRewards, errors, generateRandomAmounts, runFuzzTests } from "../scripts/utils";

const ONE_MONTH = 30 * ONE_DAY;
const TWO_MONTHS = 60 * ONE_DAY;
const THREE_MONTHS = 90 * ONE_DAY;
const SIX_MONTHS = 180 * ONE_DAY;
const ONE_YEAR = 360 * ONE_DAY;

describe("Staking", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployStakingFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount, ...accounts] = await hre.ethers.getSigners();

    const stakingToken = await hre.ethers.deployContract("PurchaseToken");

    const staking = await hre.ethers.deployContract("Staking", [
      await stakingToken.getAddress(),
      rewardRatioNumerator,
      stakingTokenCap(await stakingToken.decimals()),
      minStakingBoostAmount(await stakingToken.decimals()),
    ]);

    // Assign the first 50 accounts for stress testing
    const users = accounts.slice(0, 50);

    return { staking, stakingToken, owner, otherAccount, users };
  }

  describe("Deployment", function () {
    it("Should revert if staking token is invalid", async function () {
      const { staking, stakingToken } = await loadFixture(deployStakingFixture);

      await expect(
        hre.ethers.deployContract("Staking", [
          ZeroAddress,
          rewardRatioNumerator,
          stakingTokenCap(await stakingToken.decimals()),
          minStakingBoostAmount(await stakingToken.decimals()),
        ])
      ).to.be.revertedWithCustomError(staking, errors.invalidTokenAddress);
    });
    it("Should revert if numerator is invalid", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      const stakingToken = await hre.ethers.deployContract("PurchaseToken");

      await expect(
        hre.ethers.deployContract("Staking", [
          await stakingToken.getAddress(),
          0,
          stakingTokenCap(await stakingToken.decimals()),
          minStakingBoostAmount(await stakingToken.decimals()),
        ])
      ).to.be.revertedWithCustomError(staking, errors.invalidRewardRatio);
    });
    it("Should set constructor params", async function () {
      const { staking, stakingToken } = await loadFixture(deployStakingFixture);

      expect(await staking.stakingToken()).to.equal(await stakingToken.getAddress());
      expect((await staking.getRewardRatio())[0]).to.equal(rewardRatioNumerator);
      expect((await staking.getRewardRatio())[1]).to.equal(rewardRatioDenominator);
    });
  });

  describe("stake", function () {
    it("Should revert if user tries to stake zero token", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      await expect(staking.stake(0)).to.be.revertedWithCustomError(staking, errors.invalidAmount);
    });
    it("Should revert if the contract is paused", async function () {
      const { staking, stakingToken } = await loadFixture(deployStakingFixture);
      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      await staking.pause();

      await expect(staking.stake(1)).to.be.revertedWithCustomError(staking, errors.paused);

      await staking.unpause();

      await expect(staking.stake(1)).not.to.be.reverted;
    });
    it("Should revert if user tries to stake more than cap", async function () {
      const { staking, stakingToken } = await loadFixture(deployStakingFixture);

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      await expect(staking.stake(MaxUint256)).to.be.revertedWithCustomError(staking, errors.cannotStakeMoreThanCap);
    });
    it("Should let the user stake his token and update the state accordingly", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      const amount = stakeAmount(await stakingToken.decimals());
      const tx = staking.stake(amount);

      await expect(tx).to.changeTokenBalances(stakingToken, [await staking.getAddress(), owner.address], [amount, -amount]);

      const txResponse = await tx;

      const staker = await staking.stakers(owner.address);
      expect(staker.amountStaked).to.equal(amount);
      expect(staker.conditionIdOfLastUpdate).to.equal(0);
      expect(staker.timeOfLastBoostUpdate).to.equal((await txResponse.getBlock())?.timestamp);
      expect(staker.timeOfLastUpdate).to.equal((await txResponse.getBlock())?.timestamp);
      expect(staker.unclaimedRewards).to.equal(0);

      expect(await staking.stakingTokenBalance()).to.equal(amount);
    });
    it("Should let the user stake his token in multiple times and update the state accordingly", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      const amount = stakeAmount(await stakingToken.decimals());
      const tx = staking.stake(amount);

      await expect(tx).to.changeTokenBalances(stakingToken, [await staking.getAddress(), owner.address], [amount, -amount]);

      const txResponse = await tx;

      let staker = await staking.stakers(owner.address);
      expect(staker.amountStaked).to.equal(amount);
      expect(staker.conditionIdOfLastUpdate).to.equal(0);
      expect(staker.timeOfLastBoostUpdate).to.equal((await txResponse.getBlock())?.timestamp);
      expect(staker.timeOfLastUpdate).to.equal((await txResponse.getBlock())?.timestamp);
      expect(staker.unclaimedRewards).to.equal(0);
      expect(await staking.stakingTokenBalance()).to.equal(amount);

      const tx2 = staking.stake(amount);

      await expect(tx2).to.changeTokenBalances(stakingToken, [await staking.getAddress(), owner.address], [amount, -amount]);

      const txResponse2 = await tx2;

      staker = await staking.stakers(owner.address);
      expect(staker.amountStaked).to.equal(2n * amount);
      expect(staker.conditionIdOfLastUpdate).to.equal(0);
      expect(staker.timeOfLastBoostUpdate).to.equal((await txResponse.getBlock())?.timestamp);
      expect(staker.timeOfLastUpdate).to.equal((await txResponse2.getBlock())?.timestamp);
      expect(staker.unclaimedRewards).to.equal(calculateExpectedRewards(amount, 100, ((await txResponse2.getBlock())?.timestamp || 0) - ((await txResponse.getBlock())?.timestamp || 0)));
      expect(await staking.stakingTokenBalance()).to.equal(2n * amount);

      await time.increase(ONE_YEAR);

      const tx3 = staking.stake(amount);

      await expect(tx3).to.changeTokenBalances(stakingToken, [await staking.getAddress(), owner.address], [amount, -amount]);

      const txResponse3 = await tx3;

      const now = (await hre.ethers.provider.getBlock("latest"))?.timestamp || 0;
      const rewardAmount = calculateExpectedRewards(2n * amount, 100, now - ((await txResponse.getBlock())?.timestamp || 0))

      staker = await staking.stakers(owner.address);
      expect(staker.amountStaked).to.equal(3n * amount);
      expect(staker.conditionIdOfLastUpdate).to.equal(0);
      expect(staker.timeOfLastBoostUpdate).to.equal((await txResponse.getBlock())?.timestamp);
      expect(staker.timeOfLastUpdate).to.equal((await txResponse3.getBlock())?.timestamp);
      expect(staker.unclaimedRewards).to.closeTo(rewardAmount, parseUnits("0.001", await stakingToken.decimals()));
      expect(await staking.stakingTokenBalance()).to.equal(3n * amount);
    });
    it("Should let the user stake his token in multiple times and update the state accordingly with multipliers", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

      await staking.setTiers(tiersDurations, tiersMultipliers);

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      const amount = stakeAmount(await stakingToken.decimals());
      await staking.stake(amount);

      // At time 0
      let stakeInfo = await staking.getStakeInfo(owner.address);
      expect(stakeInfo._tokensStaked).to.equal(amount);
      expect(stakeInfo._rewards).to.equal(0n);
      expect(await staking.getCurrentMultiplier(owner.address)).to.equal(100n);

      await time.increase(ONE_MONTH);

      expect(await staking.getCurrentMultiplier(owner.address)).to.equal(110n);

      // After 1 month
      stakeInfo = await staking.getStakeInfo(owner.address);
      expect(stakeInfo._tokensStaked).to.equal(amount);
      let reward = calculateExpectedRewards(amount, 110, ONE_MONTH);
      expect(stakeInfo._rewards).to.equal(reward);

      await time.increase(TWO_MONTHS);
      expect(await staking.getCurrentMultiplier(owner.address)).to.equal(120n);

      // After 3 months
      stakeInfo = await staking.getStakeInfo(owner.address);
      expect(stakeInfo._tokensStaked).to.equal(amount);
      reward = calculateExpectedRewards(amount, 120, THREE_MONTHS);
      expect(stakeInfo._rewards).to.equal(reward);

      await time.increase(THREE_MONTHS);
      expect(await staking.getCurrentMultiplier(owner.address)).to.equal(140n);

      // After 6 months
      stakeInfo = await staking.getStakeInfo(owner.address);
      expect(stakeInfo._tokensStaked).to.equal(amount);
      reward = calculateExpectedRewards(amount, 140, SIX_MONTHS);
      expect(stakeInfo._rewards).to.equal(reward);

      await time.increase(SIX_MONTHS);
      expect(await staking.getCurrentMultiplier(owner.address)).to.equal(160n);

      // After 12 months
      stakeInfo = await staking.getStakeInfo(owner.address);
      expect(stakeInfo._tokensStaked).to.equal(amount);
      reward = calculateExpectedRewards(amount, 160, ONE_YEAR);
      expect(stakeInfo._rewards).to.equal(reward);
    });
  });

  describe("withdraw", function () {
    it("Should revert if user tries to withdraw zero token", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      await expect(staking.withdraw(0)).to.be.revertedWithCustomError(staking, errors.invalidAmount);
    });
    it("Should revert if user tries to withdraw more tokens than staked", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      await expect(staking.withdraw(1)).to.be.revertedWithCustomError(staking, errors.invalidAmount);
    });
    it("Should revert if the contract is paused", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      await staking.pause();

      await expect(staking.withdraw(1)).to.be.revertedWithCustomError(staking, errors.paused);
    });
    it("Should let the user withdraw part of his tokens and update the state accordingly", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      const amount = stakeAmount(await stakingToken.decimals());
      const stakeTx = await staking.stake(amount);

      const withdrawAmount = 100n;
      const tx = staking.withdraw(withdrawAmount);

      expect(tx).to.changeTokenBalances(stakingToken, [await staking.getAddress(), owner.address], [-withdrawAmount, withdrawAmount]);

      const txResponse = await tx;
      const staker = await staking.stakers(owner.address);
      expect(staker.amountStaked).to.equal(amount - withdrawAmount);
      expect(staker.conditionIdOfLastUpdate).to.equal(0);
      expect(staker.timeOfLastBoostUpdate).to.approximately((await txResponse.getBlock())?.timestamp, 1n);
      expect(staker.timeOfLastUpdate).to.equal((await txResponse.getBlock())?.timestamp);
      expect(staker.unclaimedRewards).to.equal(calculateExpectedRewards(amount, 100, ((await (await tx).getBlock())?.timestamp || 0) - ((await stakeTx.getBlock())?.timestamp || 0)));
      expect(await staking.stakingTokenBalance()).to.equal(amount - withdrawAmount);
    });
    it("Should let the user withdraw all of his tokens and update the state accordingly", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      const amount = stakeAmount(await stakingToken.decimals());
      const stakeTx = await staking.stake(amount);
      const tx = staking.withdraw(amount);

      expect(tx).to.changeTokenBalances(stakingToken, [await staking.getAddress(), owner.address], [-amount, amount]);

      const txResponse = await tx;
      const staker = await staking.stakers(owner.address);
      const expectedRewards = calculateExpectedRewards(amount, 100, ((await (await tx).getBlock())?.timestamp || 0) - ((await stakeTx.getBlock())?.timestamp || 0))
      expect(staker.amountStaked).to.equal(0);
      expect(staker.conditionIdOfLastUpdate).to.equal(0);
      expect(staker.timeOfLastBoostUpdate).to.approximately((await txResponse.getBlock())?.timestamp, 1n);
      expect(staker.timeOfLastUpdate).to.equal((await txResponse.getBlock())?.timestamp);
      expect(staker.unclaimedRewards).to.equal(expectedRewards);
      expect(await staking.stakingTokenBalance()).to.equal(0);
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(100n);

      await expect(staking.withdraw(1)).to.be.revertedWithCustomError(staking, errors.invalidAmount);
      expect(staker.amountStaked).to.equal(0);
      expect(staker.conditionIdOfLastUpdate).to.equal(0);
      expect(staker.timeOfLastBoostUpdate).to.approximately((await txResponse.getBlock())?.timestamp, 1n);
      expect(staker.timeOfLastUpdate).to.equal((await txResponse.getBlock())?.timestamp);
      expect(staker.unclaimedRewards).to.equal(expectedRewards);
      expect(await staking.stakingTokenBalance()).to.equal(0);
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(100n);

      await expect(staking.claimRewards()).to.be.revertedWithCustomError(staking, errors.missingRewards);
      expect(staker.amountStaked).to.equal(0);
      expect(staker.conditionIdOfLastUpdate).to.equal(0);
      expect(staker.timeOfLastBoostUpdate).to.approximately((await txResponse.getBlock())?.timestamp, 1n);
      expect(staker.timeOfLastUpdate).to.equal((await txResponse.getBlock())?.timestamp);
      expect(staker.unclaimedRewards).to.equal(expectedRewards);
      expect(await staking.stakingTokenBalance()).to.equal(0);
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(100n);
    });
  });

  describe("claimRewards", function () {
    it("Should revert if user tries to claim zero token", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      await expect(staking.claimRewards()).to.be.revertedWithCustomError(staking, errors.noRewards);
    });
    it("Should revert if the contract is paused", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      await staking.pause();

      await expect(staking.claimRewards()).to.be.revertedWithCustomError(staking, errors.paused);
    });
    it("Should revert if the user tries to claim more than rewards token balance", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      const amount = stakeAmount(await stakingToken.decimals());
      const stakeTx = await staking.stake(amount);

      await time.increase(ONE_YEAR);


      await expect(staking.claimRewards()).to.be.revertedWithCustomError(staking, errors.missingRewards);
      const stakeInfo = await staking.getStakeInfo(await owner.getAddress());
      await stakingToken.transfer(await staking.getAddress(), stakeInfo._rewards - 10n);


      const tx = staking.claimRewards();
      await expect(tx).to.be.revertedWithCustomError(staking, errors.missingRewards);
    });
    it("Should let the user claim his reward and update the state accordingly", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      const amount = stakeAmount(await stakingToken.decimals());
      const stakeTx = await staking.stake(amount);

      await time.increase(ONE_YEAR);

      await stakingToken.transfer(await staking.getAddress(), amount);

      const tx = staking.claimRewards();
      const rewardAmount = calculateExpectedRewards(amount, 100, ((await (await tx).getBlock())?.timestamp || 0) - ((await stakeTx.getBlock())?.timestamp || 0));

      await expect(tx).to.changeTokenBalances(stakingToken, [await staking.getAddress(), owner.address], [-rewardAmount, rewardAmount]);

      const txResponse = await tx;
      const staker = await staking.stakers(owner.address);
      expect(staker.amountStaked).to.equal(amount);
      expect(staker.conditionIdOfLastUpdate).to.equal(0);
      expect(staker.timeOfLastBoostUpdate).to.equal((await stakeTx.getBlock())?.timestamp);
      expect(staker.timeOfLastUpdate).to.equal((await txResponse.getBlock())?.timestamp);
      expect(staker.unclaimedRewards).to.equal(0);
    });
    it("Should let the user claim his reward and update the state accordingly with multipliers", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);
      await staking.setTiers(tiersDurations, tiersMultipliers);

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      const amount = stakeAmount(await stakingToken.decimals());
      await stakingToken.transfer(await staking.getAddress(), amount);
      const stakeTx = await staking.stake(amount);

      // At time 0
      let stakeInfo = await staking.getStakeInfo(owner.address);
      expect(stakeInfo._tokensStaked).to.equal(amount);
      expect(stakeInfo._rewards).to.equal(0n);
      expect(await staking.getCurrentMultiplier(owner.address)).to.equal(100n);
      let tx = staking.claimRewards();
      let rewardAmount = calculateExpectedRewards(amount, 100, ((await (await tx).getBlock())?.timestamp || 0) - ((await stakeTx.getBlock())?.timestamp || 0));

      await expect(tx).to.changeTokenBalances(stakingToken, [await staking.getAddress(), owner.address], [-rewardAmount, rewardAmount]);

      await time.increase(ONE_MONTH);

      // After 1 month
      expect(await staking.getCurrentMultiplier(owner.address)).to.equal(110n);
      let lastTx = tx;
      tx = staking.claimRewards();
      rewardAmount = calculateExpectedRewards(amount, 110, ((await (await tx).getBlock())?.timestamp || 0) - ((await (await lastTx).getBlock())?.timestamp || 0));

      await expect(tx).to.changeTokenBalances(stakingToken, [await staking.getAddress(), owner.address], [-rewardAmount, rewardAmount]);

      await time.increase(TWO_MONTHS);

      // After 3 months
      expect(await staking.getCurrentMultiplier(owner.address)).to.equal(120n);
      lastTx = tx;
      tx = staking.claimRewards();
      rewardAmount = calculateExpectedRewards(amount, 120, ((await (await tx).getBlock())?.timestamp || 0) - ((await (await lastTx).getBlock())?.timestamp || 0));

      await expect(tx).to.changeTokenBalances(stakingToken, [await staking.getAddress(), owner.address], [-rewardAmount, rewardAmount]);

      await time.increase(THREE_MONTHS);

      // After 6 months
      expect(await staking.getCurrentMultiplier(owner.address)).to.equal(140n);
      lastTx = tx;
      tx = staking.claimRewards();
      rewardAmount = calculateExpectedRewards(amount, 140, ((await (await tx).getBlock())?.timestamp || 0) - ((await (await lastTx).getBlock())?.timestamp || 0));

      await expect(tx).to.changeTokenBalances(stakingToken, [await staking.getAddress(), owner.address], [-rewardAmount, rewardAmount]);

      await time.increase(SIX_MONTHS);

      // After 12 months
      expect(await staking.getCurrentMultiplier(owner.address)).to.equal(160n);
      lastTx = tx;
      tx = staking.claimRewards();
      rewardAmount = calculateExpectedRewards(amount, 160, ((await (await tx).getBlock())?.timestamp || 0) - ((await (await lastTx).getBlock())?.timestamp || 0));

      await expect(tx).to.changeTokenBalances(stakingToken, [await staking.getAddress(), owner.address], [-rewardAmount, rewardAmount]);
    });
  });

  describe("emergencyWithdraw", function () {
    it("Should revert if user tries to withdraw zero token", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      await staking.pause();

      await expect(staking.emergencyWithdraw()).to.be.revertedWithCustomError(staking, errors.invalidAmount);
    });
    it("Should let the user withdraw his funds if paused", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      const amount = stakeAmount(await stakingToken.decimals());
      const stakeTx = await staking.stake(amount);

      await staking.pause();

      const tx = staking.emergencyWithdraw();

      await expect(tx).to.changeTokenBalances(stakingToken, [await staking.getAddress(), owner.address], [-amount, amount]);

      const txResponse = await tx;
      const staker = await staking.stakers(owner.address);
      expect(staker.amountStaked).to.equal(0);
      expect(staker.conditionIdOfLastUpdate).to.equal(0);
      expect(staker.timeOfLastUpdate).to.equal((await txResponse.getBlock())?.timestamp);
      expect(staker.unclaimedRewards).to.equal(calculateExpectedRewards(amount, 100, ((await txResponse.getBlock())?.timestamp || 0) - ((await stakeTx.getBlock())?.timestamp || 0)));
    });
  });

  describe("withdrawExcessTokens", function () {
    it("Should revert if user tries to withdraw zero address token", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      await expect(staking.withdrawExcessTokens(ZeroAddress, 0)).to.be.revertedWithCustomError(staking, errors.invalidTokenAddress);
    });
    it("Should revert if user tries to withdraw zero token", async function () {
      const { staking, stakingToken } = await loadFixture(deployStakingFixture);

      await expect(staking.withdrawExcessTokens(await stakingToken.getAddress(), 0)).to.be.revertedWithCustomError(staking, errors.invalidAmount);
    });
    it("Should allow withdrawals of non-staking tokens up to all the balance", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);

      const wrongToken = await hre.ethers.deployContract("PurchaseToken");

      await wrongToken.transfer(await staking.getAddress(), 100n);

      await expect(staking.withdrawExcessTokens(await wrongToken.getAddress(), 101n)).to.be.revertedWithCustomError(staking, errors.withdrawAmountExceedsLimit);

      await expect(staking.withdrawExcessTokens(await wrongToken.getAddress(), 100n)).to.changeTokenBalances(
        wrongToken,
        [await staking.getAddress(), owner.address],
        [-100n, 100n]
      );
    });
    it("Should allow withdrawals of staking tokens only up to directly sent amount", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      const amount = stakeAmount(await stakingToken.decimals());
      await staking.stake(amount);

      await stakingToken.transfer(await staking.getAddress(), 100n);

      await expect(staking.withdrawExcessTokens(await stakingToken.getAddress(), 101n)).to.be.revertedWithCustomError(
        staking,
        errors.withdrawAmountExceedsLimit
      );

      await expect(staking.withdrawExcessTokens(await stakingToken.getAddress(), 100n)).to.changeTokenBalances(
        stakingToken,
        [await staking.getAddress(), owner.address],
        [-100n, 100n]
      );

      await expect(staking.withdrawExcessTokens(await stakingToken.getAddress(), 1n)).to.be.revertedWithCustomError(staking, errors.noExcessStakingToken);
    });
  });

  describe("setTiers", function () {
    it("Should revert if input arrays lengths differ", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      await expect(staking.setTiers([], [0])).to.be.revertedWithCustomError(staking, errors.invalidTiersLength);
      await expect(staking.setTiers([0, 0], [0])).to.be.revertedWithCustomError(staking, errors.invalidTiersLength);
      await expect(staking.setTiers([0], [])).to.be.revertedWithCustomError(staking, errors.invalidTiersLength);
      await expect(staking.setTiers([0], [0, 0])).to.be.revertedWithCustomError(staking, errors.invalidTiersLength);
    });
    it("Should revert if input arrays are empty", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      await expect(staking.setTiers([], [])).to.be.revertedWithCustomError(staking, errors.invalidTiersLength);
    });
    it("Should revert if durations array is not ordered", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      await expect(staking.setTiers([0, 100, 300, 200], [0, 100, 125, 150])).to.be.revertedWithCustomError(staking, errors.invalidTiersDurations);
    });
    it("Should update tiers", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      await staking.setTiers([0, 100, 200, 300], [0, 100, 125, 150]);

      await staking.setTiers([0, 100, 200], [0, 100, 125]);

      let tier = await staking.tiers(0)
      expect(tier.minStakingDuration).to.equal(0n)
      expect(tier.multiplier).to.equal(0n)

      tier = await staking.tiers(1)
      expect(tier.minStakingDuration).to.equal(100n)
      expect(tier.multiplier).to.equal(100n)

      tier = await staking.tiers(2)
      expect(tier.minStakingDuration).to.equal(200n)
      expect(tier.multiplier).to.equal(125n)

      await expect(staking.tiers(3)).to.be.reverted
    });
  });

  describe("setStakingTokenCap", function () {
    it("Should update the staking token cap", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      const stakingTokenCap = await staking.stakingTokenCap();
      const newStakingTokenCap = stakingTokenCap + 100n;

      await staking.setStakingTokenCap(newStakingTokenCap);

      expect(await staking.stakingTokenCap()).to.equal(newStakingTokenCap);
    });
  });

  describe("getStakeInfo", function () {
    it("Should get good up to date data about staking", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

      let stakeInfo = await staking.getStakeInfo(owner.address);
      expect(stakeInfo._rewards).to.equal(0n);
      expect(stakeInfo._tokensStaked).to.equal(0n);

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      const amount = stakeAmount(await stakingToken.decimals());
      const stakeTx = await staking.stake(amount);

      stakeInfo = await staking.getStakeInfo(owner.address);
      expect(stakeInfo._rewards).to.equal(0n);
      expect(stakeInfo._tokensStaked).to.equal(amount);

      await time.increase(ONE_YEAR);

      await staking.stake(amount);
      const now = (await hre.ethers.provider.getBlock("latest"))?.timestamp || 0;
      const rewardAmount = calculateExpectedRewards(amount, 100, now - ((await stakeTx.getBlock())?.timestamp || 0))

      stakeInfo = await staking.getStakeInfo(owner.address);
      expect(stakeInfo._rewards).to.closeTo(rewardAmount, parseUnits("0.001", await stakingToken.decimals()));
      expect(stakeInfo._tokensStaked).to.equal(2n * amount);
    });
  });

  describe("setRewardRatio", function () {
    it("Should revert if it is not updating the reward ratio", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      await expect(staking.setRewardRatio(rewardRatioNumerator)).to.be.revertedWithCustomError(staking, errors.invalidRewardRatio);
    });
    it("Should revert if trying to set reward numerator to zero", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      await expect(staking.setRewardRatio(0)).to.be.revertedWithCustomError(staking, errors.invalidRewardRatio);
    });
    it("Should set the new reward ratio", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

      const newRewardRatioNumerator = 300n;
      await staking.setRewardRatio(newRewardRatioNumerator);

      const rewardRatio = await staking.getRewardRatio();
      expect(rewardRatio._numerator).to.equal(newRewardRatioNumerator);
      expect(rewardRatio._denominator).to.equal(rewardRatioDenominator);

      await stakingToken.approve(await staking.getAddress(), MaxUint256);
      const amount = stakeAmount(await stakingToken.decimals());
      await staking.stake(amount);

      const staker = await staking.stakers(owner.address);
      expect(staker.conditionIdOfLastUpdate).to.equal(1);
    });
  });

  describe("calculateAPR", function () {
    it("Should calculate the right APRs", async function () {
      const { staking, stakingToken } = await loadFixture(deployStakingFixture);

      expect(await staking.calculateAPR()).to.equal(0n);

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      const amount = stakeAmount(await stakingToken.decimals());
      await staking.stake(amount);
      const rewardAmount = amount * rewardRatioNumerator / (rewardRatioDenominator)

      expect(await staking.calculateAPR()).to.equal(rewardAmount);
    });
  });

  describe("getCurrentMultiplier", function () {
    it("Should return default multiplier for non staking users", async function () {
      const { staking } = await loadFixture(deployStakingFixture);

      await staking.setTiers(tiersDurations, tiersMultipliers);

      expect(await staking.getCurrentMultiplier(ZeroAddress)).to.equal(100n);
    });
    it("Should return default multiplier when tiers not set", async function () {
      const { staking, stakingToken } = await loadFixture(deployStakingFixture);

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      await staking.stake(parseUnits("100000", await stakingToken.decimals()));

      expect(await staking.getCurrentMultiplier(ZeroAddress)).to.equal(100n);
    });
    it("Should return default multiplier when not boosted", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);
      await staking.setTiers(tiersDurations, tiersMultipliers);
      await staking.setMinStakingBoostAmount(parseUnits("500", await stakingToken.decimals()));

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      const txResponse = await staking.stake(parseUnits("400", await stakingToken.decimals())); // Below the boost threshold
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(100);

      const staker = await staking.stakers(owner.address);
      expect(staker.conditionIdOfLastUpdate).to.equal(0);
      expect(staker.timeOfLastBoostUpdate).to.equal(0);
      expect(staker.timeOfLastUpdate).to.equal((await txResponse.getBlock())?.timestamp);
      expect(staker.unclaimedRewards).to.equal(0);
    });
    it("Should update the multiplier after crossing the minimum boost amount", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);
      await staking.setTiers(tiersDurations, tiersMultipliers);
      await staking.setMinStakingBoostAmount(parseUnits("500", await stakingToken.decimals()));

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      const txResponse = await staking.stake(parseUnits("500", await stakingToken.decimals())); // Exactly at the threshold
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(100);

      const staker = await staking.stakers(owner.address);
      expect(staker.conditionIdOfLastUpdate).to.equal(0);
      expect(staker.timeOfLastBoostUpdate).to.equal((await txResponse.getBlock())?.timestamp);
      expect(staker.timeOfLastUpdate).to.equal((await txResponse.getBlock())?.timestamp);
      expect(staker.unclaimedRewards).to.equal(0);

      await time.increase(ONE_MONTH);
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(110);
    });
    it("Should properly handle staking at and above the boost threshold over time", async function () {
      const { staking, owner, stakingToken } = await loadFixture(deployStakingFixture);
      await staking.setTiers(tiersDurations, tiersMultipliers);
      await staking.setMinStakingBoostAmount(parseUnits("500", await stakingToken.decimals()));

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      // First, stake below threshold
      const txResponse = await staking.stake(parseUnits("300", await stakingToken.decimals()));
      await time.increase(ONE_MONTH);
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(100);

      let staker = await staking.stakers(owner.address);
      expect(staker.conditionIdOfLastUpdate).to.equal(0);
      expect(staker.timeOfLastBoostUpdate).to.equal(0);
      expect(staker.timeOfLastUpdate).to.equal((await txResponse.getBlock())?.timestamp);
      expect(staker.unclaimedRewards).to.equal(0);

      // Cross the threshold
      const txResponse2 = await staking.stake(parseUnits("200", await stakingToken.decimals())); // Now total 500, at threshold
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(100);
      await time.increase(ONE_MONTH);
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(110);

      staker = await staking.stakers(owner.address);
      expect(staker.conditionIdOfLastUpdate).to.equal(0);
      expect(staker.timeOfLastBoostUpdate).to.equal((await txResponse2.getBlock())?.timestamp);
      expect(staker.timeOfLastUpdate).to.equal((await txResponse2.getBlock())?.timestamp);

      // Time passes, checking tier updates
      await time.increase(TWO_MONTHS);
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(120); // Check if multiplier increased correctly

      // Additional staking after time
      const txResponse3 = await staking.stake(parseUnits("100", await stakingToken.decimals())); // Increase the stake further
      await time.increase(ONE_MONTH); // Additional time passes
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(120); // Ensure multiplier is still correct

      staker = await staking.stakers(owner.address);
      expect(staker.conditionIdOfLastUpdate).to.equal(0);
      expect(staker.timeOfLastBoostUpdate).to.equal((await txResponse2.getBlock())?.timestamp);
      expect(staker.timeOfLastUpdate).to.equal((await txResponse3.getBlock())?.timestamp);
    });
    it("Should revert multiplier to default when stakes drop below threshold then re-increase", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);
      await staking.setTiers(tiersDurations, tiersMultipliers);
      await staking.setMinStakingBoostAmount(parseUnits("500", await stakingToken.decimals()));

      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      await staking.stake(parseUnits("600", await stakingToken.decimals())); // Above the threshold
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(100);
      await time.increase(ONE_MONTH);
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(110);

      await staking.withdraw(parseUnits("300", await stakingToken.decimals())); // Drops below threshold
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(100);
      await time.increase(ONE_MONTH);
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(100);

      await staking.stake(parseUnits("300", await stakingToken.decimals())); // Back above the threshold
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(100);
      await time.increase(ONE_MONTH);
      expect(await staking.getCurrentMultiplier(await owner.getAddress())).to.equal(110);
    });
  });

  describe("State Persistence", function () {
    it("Should correctly handle multiple staking transactions by the same user", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

      // Approve maximum tokens
      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      // Initial stake
      const initialStake = stakeAmount(await stakingToken.decimals());
      await staking.stake(initialStake);

      // Second stake
      const secondStake = stakeAmount(await stakingToken.decimals());
      await staking.stake(secondStake);

      // Check combined state
      const combinedStake = initialStake + secondStake;
      expect(await staking.stakingTokenBalance()).to.equal(combinedStake);

      const stakerInfo = await staking.stakers(owner.address);
      expect(stakerInfo.amountStaked).to.equal(combinedStake);
    });
  });

  describe("State Rollback", function () {
    it("Should revert state if staking more than cap causes failure", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

      // Set token cap to a specific limit
      const capAmount = stakeAmount(await stakingToken.decimals());
      await staking.setStakingTokenCap(capAmount);

      // Approve maximum tokens
      await stakingToken.approve(await staking.getAddress(), MaxUint256);

      // Attempt to stake more than cap
      const excessiveAmount = capAmount + 1n;
      await expect(staking.stake(excessiveAmount)).to.be.revertedWithCustomError(staking, errors.cannotStakeMoreThanCap);

      // Verify that the staking balance did not change
      expect(await staking.stakingTokenBalance()).to.equal(0);

      const stakerInfo = await staking.stakers(owner.address);
      expect(stakerInfo.amountStaked).to.equal(0);
    });
  });

  describe("Inter-function State Changes", function () {
    it("Should update staker's rewards and balances across staking and claiming rewards", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

      // Approve maximum tokens
      await stakingToken.approve(await staking.getAddress(), MaxUint256);
      await stakingToken.transfer(await staking.getAddress(), parseUnits("1000", await stakingToken.decimals()));

      // Stake some amount
      const stakeAmount = parseUnits("100", await stakingToken.decimals());
      await staking.stake(stakeAmount);

      // Increase time to generate some rewards
      await time.increase(ONE_YEAR);

      // Claim rewards
      await staking.claimRewards();

      // Check balances and state changes
      const postClaimStakerInfo = await staking.stakers(owner.address);
      expect(postClaimStakerInfo.amountStaked).to.equal(stakeAmount);
      expect(postClaimStakerInfo.unclaimedRewards).to.equal(0); // Rewards should be reset after claiming

      const stakingBalance = await staking.stakingTokenBalance();
      expect(stakingBalance).to.equal(stakeAmount); // Ensure staking balance is correct after claiming rewards
    });
  });

  describe("Tier Boundary Staking", function () {
    it("Should apply correct multipliers when staking at the exact boundary of tier changes", async function () {
      await runFuzzTests(async () => {

        const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

        await staking.setTiers(tiersDurations, tiersMultipliers);
        await staking.setMinStakingBoostAmount(100);

        // Approve maximum tokens
        await stakingToken.approve(await staking.getAddress(), MaxUint256);

        // Stake tokens just before the first tier change
        const stakeAmount = parseUnits("100", await stakingToken.decimals());
        const stakeTx1 = await staking.stake(stakeAmount);

        // Increase time to the exact boundary of the first tier
        await time.increase(31 * ONE_DAY);

        // Stake again at the boundary, which should trigger reward calculations using the first tier multiplier
        const stakeTx2 = await staking.stake(stakeAmount);

        // Calculate expected rewards based on simulated conditions and test logic
        const expectedRewards = calculateExpectedRewards(stakeAmount, tiersMultipliers[0], ((await stakeTx2.getBlock())?.timestamp || 0) - ((await stakeTx1.getBlock())?.timestamp || 0));

        // Check rewards calculation at the boundary
        const finalRewards = await staking.getStakeInfo(owner.address);
        expect(finalRewards._tokensStaked).to.be.closeTo(2n * stakeAmount, parseUnits("0.01", await stakingToken.decimals()));
        expect(finalRewards._rewards).to.be.closeTo(BigInt(expectedRewards), parseUnits("0.01", await stakingToken.decimals()));
      }, 100, 1, 50000000);
    });
  });

  describe("Rapid Successive Multiplier Changes", function () {
    it("Should accurately calculate rewards with rapid successive changes in multipliers", async function () {
      await runFuzzTests(async (amount) => {
        const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);
        await staking.setTiers(tiersDurations, tiersMultipliers);
        await staking.setMinStakingBoostAmount(100);

        // Approve maximum tokens
        await stakingToken.approve(await staking.getAddress(), MaxUint256);

        // Stake tokens just before the first tier change
        const stakeAmount = parseUnits(amount.toString(), await stakingToken.decimals());
        const stakeTx1 = await staking.stake(stakeAmount);

        // Increase time and simulate rapid changes
        await time.increase(29 * ONE_DAY); // just before the first tier change
        let now = (await hre.ethers.provider.getBlock("latest"))?.timestamp || 0
        let expectedRewards = calculateExpectedRewards(stakeAmount, 100, now - ((await stakeTx1.getBlock())?.timestamp || 0));
        let partialRewards = await staking.getStakeInfo(owner.address).then((info) => info._rewards);
        expect(partialRewards).to.equal(BigInt(expectedRewards));
        const stakeTx2 = await staking.stake(stakeAmount);

        expectedRewards = calculateExpectedRewards(stakeAmount, 100, ((await stakeTx2.getBlock())?.timestamp || 0) - ((await stakeTx1.getBlock())?.timestamp || 0));
        partialRewards = await staking.getStakeInfo(owner.address).then((info) => info._rewards);
        expect(partialRewards).to.equal(BigInt(expectedRewards));

        await time.increase(2 * ONE_DAY); // crossing into the second tier
        const stakeTx3 = await staking.stake(stakeAmount);
        expectedRewards += calculateExpectedRewards(2n * stakeAmount, stakeAmount > 100 ? tiersMultipliers[0] : 100, ((await stakeTx3.getBlock())?.timestamp || 0) - ((await stakeTx2.getBlock())?.timestamp || 0));
        partialRewards = await staking.getStakeInfo(owner.address).then((info) => info._rewards);
        expect(partialRewards).to.equal(BigInt(expectedRewards));

        await time.increase(10 * ONE_DAY); // further into the second tier

        // Calculate expected rewards based on simulated conditions and test logic
        now = (await hre.ethers.provider.getBlock("latest"))?.timestamp || 0
        expectedRewards += calculateExpectedRewards(3n * stakeAmount, tiersMultipliers[0], now - ((await stakeTx3.getBlock())?.timestamp || 0));

        // Check overall rewards
        const totalRewards = await staking.getStakeInfo(owner.address).then((info) => info._rewards);
        expect(totalRewards).to.be.closeTo(BigInt(expectedRewards), parseUnits("0.001", await stakingToken.decimals()));
      }, 100, 1, 50000000 / 3);
    });
  });

  describe("Reward Precision Tests", function () {
    it("Should correctly calculate rewards for minimum stakable amount", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

      // Set a minimal staking amount
      const minStakeAmount = BigInt(1); // 1 wei of token

      // Set tiers to test different multipliers
      const tiersDurations = [ONE_DAY, ONE_MONTH, THREE_MONTHS];
      const tiersMultipliers = [100, 110, 120];
      await staking.setTiers(tiersDurations, tiersMultipliers);

      // Approve and stake the minimal amount
      await stakingToken.approve(await staking.getAddress(), minStakeAmount);
      await staking.stake(minStakeAmount);

      // Move forward in time to accumulate some rewards
      await time.increase(THREE_MONTHS);

      // Calculate expected rewards
      const expectedRewards = calculateExpectedRewards(minStakeAmount, tiersMultipliers[2], THREE_MONTHS);

      // Check rewards calculation
      const { _rewards } = await staking.getStakeInfo(owner.address);
      expect(_rewards).to.equal(expectedRewards);
    });
    it("Should correctly calculate rewards for maximum stakable amount", async function () {
      const { staking, stakingToken, owner } = await loadFixture(deployStakingFixture);

      // Set a large staking amount to test overflow boundaries
      const maxStakeAmount = BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935"); // Close to the max uint256 value
      await staking.setStakingTokenCap(maxStakeAmount);

      // Set tiers to test different multipliers
      const tiersDurations = [ONE_DAY, ONE_MONTH, THREE_MONTHS];
      const tiersMultipliers = [100, 110, 120];
      await staking.setTiers(tiersDurations, tiersMultipliers);

      // Approve and stake the maximum amount
      await stakingToken.approve(await staking.getAddress(), maxStakeAmount);
      await staking.stake(maxStakeAmount);

      // Move forward in time to potentially hit overflow during reward calculation
      await time.increase(THREE_MONTHS);

      // Check rewards calculation
      const { _rewards } = await staking.getStakeInfo(owner.address);
      expect(_rewards).to.equal(0n); // because of overflow
    });
  });

  describe("High Load Tests", function () {
    it("should handle high load of concurrent staking actions", async function () {
      const { staking, stakingToken, users } = await loadFixture(deployStakingFixture);
      await staking.setStakingTokenCap(MaxUint256);
      const stakeAmount = parseUnits("1", await stakingToken.decimals());

      // Approve the staking amount for all users
      await Promise.all(users.map(async (user) => stakingToken.transfer(await user.getAddress(), stakeAmount)));
      await Promise.all(users.map(async (user) => stakingToken.connect(user).approve(await staking.getAddress(), stakeAmount)));

      // Simulate each user staking concurrently
      const stakingPromises = users.map((user) => staking.connect(user).stake(stakeAmount));

      // Wait for all staking transactions to complete
      await Promise.allSettled(stakingPromises).then((results) => {
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            console.error(`Staking transaction failed for user ${index}: ${result.reason}`);
          }
          expect(result.status).to.equal("fulfilled");
        });
      });

      await Promise.all(users.map(async (user) => {
        const { _tokensStaked } = await staking.getStakeInfo(user.address);
        expect(_tokensStaked).to.equal(stakeAmount);
      }));

      // Verify the total staked amount matches the expected value
      const totalStaked = await staking.stakingTokenBalance();
      const expectedTotal = stakeAmount * BigInt(users.length);
      expect(totalStaked).to.equal(expectedTotal);
    });
    it("should correctly handle staking, adjusting rewards, claiming, and withdrawing", async function () {
      const { staking, stakingToken, users } = await loadFixture(deployStakingFixture);
      const [user1, user2] = users;
      const stakeAmountUser1 = parseUnits("100", await stakingToken.decimals());
      const stakeAmountUser2 = parseUnits("150", await stakingToken.decimals());

      await stakingToken.transfer(await staking.getAddress(), parseUnits("100000", await stakingToken.decimals()));
      await stakingToken.transfer(await user1.getAddress(), 3n * stakeAmountUser1);
      await stakingToken.transfer(await user2.getAddress(), 3n * stakeAmountUser2);

      // Users approve staking token to contract
      await stakingToken.connect(user1).approve(await staking.getAddress(), 3n * stakeAmountUser1);
      await stakingToken.connect(user2).approve(await staking.getAddress(), 3n * stakeAmountUser2);

      // First round of staking
      await staking.connect(user1).stake(stakeAmountUser1);
      await staking.connect(user2).stake(stakeAmountUser2);
      await time.increase(ONE_YEAR);
      let accruedRewardsUser1 = parseUnits("3.5", await stakingToken.decimals());
      expect((await staking.getStakeInfo(await user1.getAddress()))._rewards).to.equal(accruedRewardsUser1);
      let accruedRewardsUser2 = (accruedRewardsUser1 * 15n) / 10n;
      expect((await staking.getStakeInfo(await user2.getAddress()))._rewards).to.equal(accruedRewardsUser2);

      // Adjust reward ratio after first stake
      await staking.setRewardRatio(200);

      // Second round of staking
      await staking.connect(user1).stake(stakeAmountUser1);
      await staking.connect(user2).stake(stakeAmountUser2);
      await time.increase(ONE_YEAR);
      accruedRewardsUser1 += parseUnits("4", await stakingToken.decimals());
      expect((await staking.getStakeInfo(await user1.getAddress()))._rewards).to.equal(accruedRewardsUser1);
      accruedRewardsUser2 = (accruedRewardsUser1 * 15n) / 10n;
      expect((await staking.getStakeInfo(await user2.getAddress()))._rewards).to.equal(accruedRewardsUser2);

      // Adjust reward ratio again
      await staking.setRewardRatio(300);

      // Simulate time passage to accumulate rewards
      await time.increase(ONE_YEAR);

      accruedRewardsUser1 += parseUnits("6", await stakingToken.decimals());
      expect((await staking.getStakeInfo(await user1.getAddress()))._rewards).to.equal(accruedRewardsUser1);
      accruedRewardsUser2 = (accruedRewardsUser1 * 15n) / 10n;
      expect((await staking.getStakeInfo(await user2.getAddress()))._rewards).to.equal(accruedRewardsUser2);

      // Users claim their rewards
      await expect(staking.connect(user1).claimRewards()).to.changeTokenBalances(
        stakingToken,
        [await staking.getAddress(), await user1.getAddress()],
        [-accruedRewardsUser1, accruedRewardsUser1]
      );
      await expect(staking.connect(user2).claimRewards()).to.changeTokenBalances(
        stakingToken,
        [await staking.getAddress(), await user2.getAddress()],
        [-accruedRewardsUser2, accruedRewardsUser2]
      );

      // Users withdraw all their staked tokens
      await staking.connect(user1).withdraw(stakeAmountUser1 * 2n); // Total staked across three transactions
      await staking.connect(user2).withdraw(stakeAmountUser2 * 2n); // Total staked across three transactions

      // Check final balances
      const finalBalanceUser1 = await stakingToken.balanceOf(user1.address);
      const finalBalanceUser2 = await stakingToken.balanceOf(user2.address);

      const initialBalanceUser1 = 3n * stakeAmountUser1;
      const initialBalanceUser2 = 3n * stakeAmountUser2;

      expect(finalBalanceUser1).to.approximately(initialBalanceUser1 + accruedRewardsUser1, parseUnits("0.001", await stakingToken.decimals()));
      expect(finalBalanceUser2).to.approximately(initialBalanceUser2 + accruedRewardsUser2, parseUnits("0.001", await stakingToken.decimals()));
    });
    it("Should correctly handle staking, claiming and withdrawing after a cap upgrade", async function () {
      const { staking, stakingToken, users } = await loadFixture(deployStakingFixture);
      await staking.setTiers(tiersDurations, tiersMultipliers);

      const [user1, user2] = users;
      const stakeAmountUser1 = parseUnits("100", await stakingToken.decimals());
      const stakeAmountUser2 = parseUnits("150", await stakingToken.decimals());

      await stakingToken.transfer(await staking.getAddress(), parseUnits("100000", await stakingToken.decimals()));
      await stakingToken.transfer(await user1.getAddress(), 3n * stakeAmountUser1);
      await stakingToken.transfer(await user2.getAddress(), 3n * stakeAmountUser2);

      // Users approve staking token to contract
      await stakingToken.connect(user1).approve(await staking.getAddress(), 3n * stakeAmountUser1);
      await stakingToken.connect(user2).approve(await staking.getAddress(), 3n * stakeAmountUser2);

      // First round of staking
      await staking.connect(user1).stake(stakeAmountUser1);
      await staking.connect(user2).stake(stakeAmountUser2);
      await time.increase(ONE_YEAR);
      let accruedRewardsUser1 = parseUnits("3.5", await stakingToken.decimals());
      expect((await staking.getStakeInfo(await user1.getAddress()))._rewards).to.equal(accruedRewardsUser1);
      let accruedRewardsUser2 = (accruedRewardsUser1 * 15n) / 10n;
      expect((await staking.getStakeInfo(await user2.getAddress()))._rewards).to.equal(accruedRewardsUser2);

      // Cap Upgrade
      await staking.setStakingTokenCap(stakeAmountUser1);

      await expect(staking.connect(user1).stake(1)).to.be.revertedWithCustomError(staking, errors.cannotStakeMoreThanCap);
      await expect(staking.connect(user2).stake(1)).to.be.revertedWithCustomError(staking, errors.cannotStakeMoreThanCap);

      await expect(staking.connect(user1).claimRewards()).not.to.be.reverted;
      await expect(staking.connect(user2).claimRewards()).not.to.be.reverted;

      await expect(staking.connect(user1).withdraw(stakeAmountUser1)).not.to.be.reverted;
      await expect(staking.connect(user2).withdraw(1)).not.to.be.reverted;
      await expect(staking.connect(user2).withdraw(stakeAmountUser2 - 1n)).not.to.be.reverted;

      await expect(staking.connect(user1).stake(stakeAmountUser1)).not.to.be.reverted;
    });
    it("Should handle boost state after raising min staking boost amount upgrade", async function () {
      const { staking, stakingToken, users } = await loadFixture(deployStakingFixture);
      await staking.setTiers(tiersDurations, tiersMultipliers);

      const [user1, user2] = users;
      const stakeAmountUser1 = parseUnits("100", await stakingToken.decimals());
      const stakeAmountUser2 = parseUnits("150", await stakingToken.decimals());

      await staking.setMinStakingBoostAmount(stakeAmountUser1 - 100n);

      await stakingToken.transfer(await staking.getAddress(), parseUnits("100000", await stakingToken.decimals()));
      await stakingToken.transfer(await user1.getAddress(), 3n * stakeAmountUser1);
      await stakingToken.transfer(await user2.getAddress(), 3n * stakeAmountUser2);

      // Users approve staking token to contract
      await stakingToken.connect(user1).approve(await staking.getAddress(), 3n * stakeAmountUser1);
      await stakingToken.connect(user2).approve(await staking.getAddress(), 3n * stakeAmountUser2);

      // First round of staking
      await staking.connect(user1).stake(stakeAmountUser1);
      await staking.connect(user2).stake(stakeAmountUser2);
      await time.increase(ONE_YEAR);
      expect(await staking.getCurrentMultiplier(await user1.getAddress())).to.equal(160n);
      expect(await staking.getCurrentMultiplier(await user2.getAddress())).to.equal(160n);

      // Min Staking Boost Amount Upgrade
      await staking.setMinStakingBoostAmount(stakeAmountUser1 + 100n);
      expect(await staking.getCurrentMultiplier(await user1.getAddress())).to.equal(100n);
      expect(await staking.getCurrentMultiplier(await user2.getAddress())).to.equal(160n);
    });
    it("Should handle boost state after lowering min staking boost amount upgrade", async function () {
      const { staking, stakingToken, users } = await loadFixture(deployStakingFixture);
      await staking.setTiers(tiersDurations, tiersMultipliers);

      const [user1, user2] = users;
      const stakeAmountUser1 = parseUnits("100", await stakingToken.decimals());
      const stakeAmountUser2 = parseUnits("150", await stakingToken.decimals());

      await staking.setMinStakingBoostAmount(stakeAmountUser1 + 100n);

      await stakingToken.transfer(await staking.getAddress(), parseUnits("100000", await stakingToken.decimals()));
      await stakingToken.transfer(await user1.getAddress(), 3n * stakeAmountUser1);
      await stakingToken.transfer(await user2.getAddress(), 3n * stakeAmountUser2);

      // Users approve staking token to contract
      await stakingToken.connect(user1).approve(await staking.getAddress(), 3n * stakeAmountUser1);
      await stakingToken.connect(user2).approve(await staking.getAddress(), 3n * stakeAmountUser2);

      // First round of staking
      await staking.connect(user1).stake(stakeAmountUser1);
      await staking.connect(user2).stake(stakeAmountUser2);
      await time.increase(ONE_YEAR);
      expect(await staking.getCurrentMultiplier(await user1.getAddress())).to.equal(100n);
      expect(await staking.getCurrentMultiplier(await user2.getAddress())).to.equal(160n);

      // Min Staking Boost Amount Upgrade
      await staking.setMinStakingBoostAmount(stakeAmountUser1 - 100n);
      expect(await staking.getCurrentMultiplier(await user1.getAddress())).to.equal(100n);
      expect(await staking.getCurrentMultiplier(await user2.getAddress())).to.equal(160n);

      await time.increase(ONE_YEAR);
      expect(await staking.getCurrentMultiplier(await user1.getAddress())).to.equal(100n);
      expect(await staking.getCurrentMultiplier(await user2.getAddress())).to.equal(160n);

      await staking.connect(user1).withdraw(1);
      await time.increase(ONE_YEAR);
      expect(await staking.getCurrentMultiplier(await user1.getAddress())).to.equal(160n);
      expect(await staking.getCurrentMultiplier(await user2.getAddress())).to.equal(160n);
    });
  });

  describe("Only Owner Functions", function () {
    it("Should revert if a non-owner user tries to call only owner functions", async function () {
      const { staking, otherAccount } = await loadFixture(deployStakingFixture);

      await expect(staking.connect(otherAccount).pause()).to.be.revertedWithCustomError(staking, errors.callerNotOwner);
      await expect(staking.connect(otherAccount).unpause()).to.be.revertedWithCustomError(staking, errors.callerNotOwner);
      await expect(staking.connect(otherAccount).withdrawExcessTokens(ZeroAddress, 0)).to.be.revertedWithCustomError(staking, errors.callerNotOwner);
      await expect(staking.connect(otherAccount).setRewardRatio(0)).to.be.revertedWithCustomError(staking, errors.callerNotOwner);
      await expect(staking.connect(otherAccount).setTiers([], [])).to.be.revertedWithCustomError(staking, errors.callerNotOwner);
      await expect(staking.connect(otherAccount).setMinStakingBoostAmount(0)).to.be.revertedWithCustomError(staking, errors.callerNotOwner);
      await expect(staking.connect(otherAccount).setStakingTokenCap(0)).to.be.revertedWithCustomError(staking, errors.callerNotOwner);
    })
  })
});
