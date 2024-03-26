import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "hardhat";
import { minStakingBoostAmount as minStakingBoostAmountConfig, rewardRatioNumerator as rewardRatioNumeratorConfig, stakingTokenCap as stakingTokenCapConfig } from "../../config/config";

const StakingModule = buildModule("StakingModule", (m) => {
  if (!process.env.LCD_ADDRESS) {
    throw new Error("Missing env variable: LCD_ADDRESS");
  }

  ethers.getSigners().then(([deployer]) => {
    console.log(`Deploying contracts with the account: ${deployer.address}`);
  });

  const stakingTokenAddress = m.getParameter("_stakingToken", process.env.LCD_ADDRESS);
  const rewardRatioNumerator = m.getParameter("_rewardRatioNumerator", rewardRatioNumeratorConfig);
  const stakingTokenCap = m.getParameter("_stakingTokenCap", stakingTokenCapConfig(18n));
  const minStakingBoostAmount = m.getParameter("_minStakingBoostAmount", minStakingBoostAmountConfig(18n));

  const staking = m.contract("Staking", [stakingTokenAddress, rewardRatioNumerator, stakingTokenCap, minStakingBoostAmount]);

  return { staking };
});

export default StakingModule;
