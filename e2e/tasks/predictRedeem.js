#!/usr/bin/env node
/**
 * predictRedeem.js — Redeem a set of YES + NO tokens back for AXT.
 *
 * How it works:
 *   EventBasedPredictionMarket.redeem(amount) burns equal amounts of YES and NO
 *   tokens and returns AXT collateral. Requires approval of BOTH YES and NO
 *   tokens for the market contract.
 *
 * Usage:
 *   RPC_URL=https://polygon-rpc.com \
 *   node predictRedeem.js <privateKey> <marketAddress> <tokenAmount>
 *
 * Example (redeem 1 unit of YES+NO tokens for ~1 AXT):
 *   RPC_URL=https://polygon-rpc.com \
 *   node predictRedeem.js 0xPRIVKEY 0xMARKET_ADDR 1
 */

'use strict';

const { ethers } = require('ethers');
const { parseError } = require('../parseError');
const { gasLog } = require('../gasLog');

const log = require('debug')(`e2e:${require('path').basename(__filename, '.js')}`);

const EVENT_MARKET_ABI = [
    'function redeem(uint256 amount) external',
    'function yesToken() external view returns (address)',
    'function noToken() external view returns (address)',
];

const ERC20_ABI = [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
];

async function predictRedeem({ wallet, marketAddress, tokenAmount }) {
    log({ address: wallet.address, marketAddress, tokenAmount });

    const market = new ethers.Contract(marketAddress, EVENT_MARKET_ABI, wallet);
    const amount = ethers.utils.parseEther(`${tokenAmount}`);

    // Read YES/NO token addresses
    const [yesTokenAddr, noTokenAddr] = await Promise.all([
        market.yesToken().catch(parseError),
        market.noToken().catch(parseError),
    ]);
    log({ yesTokenAddr, noTokenAddr });

    const yesToken = new ethers.Contract(yesTokenAddr, ERC20_ABI, wallet);
    const noToken = new ethers.Contract(noTokenAddr, ERC20_ABI, wallet);

    // Approve both YES and NO tokens for the market contract
    const [yesAllowance, noAllowance] = await Promise.all([
        yesToken.allowance(wallet.address, marketAddress),
        noToken.allowance(wallet.address, marketAddress),
    ]);

    if (yesAllowance.lt(amount)) {
        log('Approving market to spend YES tokens...');
        await (await yesToken.approve(marketAddress, ethers.constants.MaxUint256).catch(parseError)).wait();
    }
    if (noAllowance.lt(amount)) {
        log('Approving market to spend NO tokens...');
        await (await noToken.approve(marketAddress, ethers.constants.MaxUint256).catch(parseError)).wait();
    }

    // Redeem
    const gasLimit = await market.estimateGas.redeem(amount).catch(parseError);
    const tx = await market.redeem(amount, { gasLimit: gasLimit.mul(2) }).catch(parseError);
    const receipt = await tx.wait().then((txn) => {
        log(txn.events);
        return txn;
    }, parseError);

    gasLog({ action: 'EventMarket.redeem (burn YES+NO → AXT)', log })({ receipt });
    return receipt;
}

module.exports = { predictRedeem };

if (require.main === module) {
    require('../inspect');
    const [privateKey, marketAddress, tokenAmount] = process.argv.slice(2);
    const provider = new ethers.providers.JsonRpcProvider(
        process.env.RPC_URL || 'https://polygon-rpc.com'
    );
    const wallet = new ethers.Wallet(privateKey, provider);
    predictRedeem({ wallet, marketAddress, tokenAmount })
        .then((data) => console.log(JSON.stringify(data, null, 2)));
}
