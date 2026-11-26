import { network } from "hardhat";

const { ethers } = await network.create();

const [deployer] = await ethers.getSigners();
console.log("Deployer:", deployer.address);

const voting = await ethers.deployContract("VotingSystem");
const tx = voting.deploymentTransaction();
console.log("Deploy tx hash:", tx.hash);

await voting.waitForDeployment();
console.log("VotingSystem deployed to:", await voting.getAddress());
