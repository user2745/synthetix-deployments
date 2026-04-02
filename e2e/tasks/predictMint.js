#!/usr/bin/env node
/**
 * predictMint.js — Mint a set of YES + NO outcome tokens from AXT.
 *
 * How it works:
 *   EventBasedPredictionMarket.create(amount) mints equal YES and NO position
 *   tokens in exchange for AXT collateral. The market contract must be approved
 *   to spend AXT first.
 *
 * Usage:
 *   RPC_URL=https://polygon-rpc.com \
 *   node predictMint.js <privateKey> <marketAddress> <axtAmount>
 *
 * Example (mint 1 AXT worth of YES+NO tokens):
 *   RPC_URL=https://polygon-rpc.com \
 *   node predictMint.js 0xPRIVKEY 0xMARKET_ADDR 1
 */

'use strict';

const { ethers } = require('ethers');
const { parseError } = require('../parseError');
const { gasLog } = require('../gasLog');

const log = require('debug')(`e2e:${require('path').basename(__filename, '.js')}`);

const AXT_ADDRESS = '0x840195888db4d6a99ed9f73fcd3b225bb3cb1a79';

const EVENT_MARKET_ABI = [
    'function create(uint256 amount) external',
    'function yesToken() external view returns (address)',
    'function noToken() external view returns (address)',
];

const ERC20_ABI = [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
];

async function predictMint({ wallet, marketAddress, axtAmount }) {
    log({ address: wallet.address, marketAddress, axtAmount });

    const market = new ethers.Contract(marketAddress, EVENT_MARKET_ABI, wallet);
    const axt = new ethers.Contract(AXT_ADDRESS, ERC20_ABI, wallet);

    // Read YES/NO token addresses for logging
    const [yesToken, noToken] = await Promise.all([
        market.yesToken().catch(() => '(unknown)'),
        market.noToken().catch(() => '(unknown)'),
    ]);
    log({ yesToken, noToken });

    const amount = ethers.utils.parseEther(`${axtAmount}`);

    // 1) Approve market to spend AXT
    const allowance = await axt.allowance(wallet.address, marketAddress);
    if (allowance.lt(amount)) {
        log('Approving market to spend AXT...');
        const approveTx = await axt.approve(marketAddress, ethers.constants.MaxUint256).catch(parseError);
        await approveTx.wait();
        log('Approved.');
    }

    // 2) Create (mint) position tokens
    const gasLimit = await market.estimateGas.create(amount).catch(parseError);
    const tx = await market.create(amount, { gasLimit: gasLimit.mul(2) }).catch(parseError);
    const receipt = await tx.wait().then((txn) => {
        log(txn.events);
        return txn;
    }, parseError);

    gasLog({ action: 'EventMarket.create (mint YES+NO)', log })({ receipt });
    return receipt;
}

module.exports = { predictMint };

if (require.main === module) {
    require('../inspect');
    const [privateKey, marketAddress, axtAmount] = process.argv.slice(2);
    const provider = new ethers.providers.JsonRpcProvider(
        process.env.RPC_URL || 'https://polygon-rpc.com'
    );
    const wallet = new ethers.Wallet(privateKey, provider);
    predictMint({ wallet, marketAddress, axtAmount })
        .then((data) => console.log(JSON.stringify(data, null, 2)));
}
