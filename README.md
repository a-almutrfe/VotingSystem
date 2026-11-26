# VotingSystem

## Members

| Name | Student ID |
|---|---|
| Ahmed Alharbi | 4405711 |
| Abdulmohsen Alsharif | 4404951 |
| Mohannad Alhindi | 4405419 |
| Yazeed Alrehaili | 4404814 |

## Contract

Address (Sepolia): `0x4644a08612e02172e26C044e8bF42247D01ad0CA`

Etherscan: https://sepolia.etherscan.io/address/0x4644a08612e02172e26C044e8bF42247D01ad0CA#code

## How to run

Requires Node.js 22 or newer.

```
npm install
npm test
npm run coverage
npx hardhat test --gas-stats
slither .
```

To deploy, copy `.env.example` to `.env`, fill in the values, then run:

```
npx hardhat run scripts/deploy.js --network sepolia
npx hardhat verify --network sepolia <CONTRACT_ADDRESS>
```
