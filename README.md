
# Lucidao Staking Smart Contracts

This repository contains the smart contracts for Lucidao's staking platform. These contracts manage the staking and reward distribution for Lucidao tokens.

## Features

- Stake Lucidao tokens
- Earn rewards based on the amount of tokens staked
- Withdraw staked tokens and rewards

## Installation

1. Clone the repository:
   ```sh
   git clone https://github.com/lucidao-developer/lucidao-staking-smart-contracts.git
   ```

2. Navigate to the project directory:
   ```sh
   cd lucidao-staking-smart-contracts
   ```

3. Install the dependencies:
   ```sh
   yarn install
   ```

## Usage

### Compile the contracts

```sh
yarn hardhat compile
```

### Deploy the contracts

```sh
yarn deploy-staking --network {network} --verify
```

Replace `<network>` with the desired network (e.g., `polygonTestnet`, `polygonMainnet`).

### Running Tests

```sh
yarn hardhat test
```

## License

This project is licensed under the Apache-2.0 License.
