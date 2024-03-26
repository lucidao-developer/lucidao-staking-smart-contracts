import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "hardhat";

const LuciDaoModule = buildModule("LuciDaoModule", (m) => {
  ethers.getSigners().then(([deployer]) => {
    console.log(`Deploying contracts with the account: ${deployer.address}`);
  });

  const luciDao = m.contract("FakeLucidao", []);

  return { luciDao };
});

export default LuciDaoModule;
