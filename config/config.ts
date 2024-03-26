import { parseUnits } from "ethers";

export const ONE_DAY = 86_400;

// Staking config
export const timeUnit = BigInt(360 * ONE_DAY);
export const rewardRatioNumerator = 350n;
export const rewardRatioDenominator = 10000n;
export const stakeAmount = (decimals: bigint) => parseUnits("25000", decimals);
export const tiersDurations = [30 * ONE_DAY, 90 * ONE_DAY, 180 * ONE_DAY, 360 * ONE_DAY];
export const tiersMultipliers = [110, 120, 140, 160];
export const stakingTokenCap = (decimals: bigint) => parseUnits("50000000", decimals);
export const minStakingBoostAmount = (decimals: bigint) => parseUnits("25000", decimals);
