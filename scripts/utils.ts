import { rewardRatioDenominator, rewardRatioNumerator, timeUnit } from "../config/config";

export const calculateExpectedRewards = (stakeAmount: bigint, multiplier: number, duration: number): bigint => {
  // Calculate rewards based on the formula used in the contract
  const rewards = (stakeAmount * BigInt(duration) * rewardRatioNumerator * BigInt(multiplier)) / (rewardRatioDenominator * timeUnit * 100n);
  return rewards;
};

export const getRandomInt = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const generateRandomAmounts = (count: number, min: number, max: number) => {
  const amounts = [];
  for (let i = 0; i < count; i++) {
    amounts.push(getRandomInt(min, max));
  }
  return amounts;
}

export const runFuzzTests = async (testFn: (amount: number) => Promise<void>, numTests = 100, min = 1, max = 1_000_000_000_000_000) => {
  const randomAmounts = generateRandomAmounts(numTests, min, max);

  let i = 1;
  for (const amount of randomAmounts) {
    try {
      await testFn(amount);
    } catch (error) {
      console.error(`Test ${i} / ${numTests} failed for amount: ${amount}`, error);
      throw error;
    }
    i++;
  }
}

export const errors = {
  callerNotOwner: "OwnableUnauthorizedAccount",
  insufficientBalance: "ERC20: transfer amount exceeds balance",
  invalidTokenAddress: "InvalidTokenAddress",
  invalidRewardRatio: "InvalidRewardRatio",
  invalidAmount: "InvalidAmount",
  noRewards: "NoRewards",
  withdrawAmountExceedsLimit: "WithdrawAmountExceedsLimit",
  noExcessStakingToken: "NoExcessStakingToken",
  invalidTiersLength: "InvalidTiersLength",
  invalidTiersDurations: "InvalidTiersDurations",
  paused: "EnforcedPause",
  notPaused: "ExpectedPause",
  cannotStakeMoreThanCap: "CannotStakeMoreThanCap",
  missingRewards: "MissingRewards"
};
