#!/usr/bin/env node
/**
 * predictSell.js — Sell YES or NO outcome tokens back to AXT.
 *
 * How it works:
 *   aptRouter.swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline)
 *   where path = [yesTokenAddress, axtAddress]  (selling YES tokens for AXT)
 *              = [noTokenAddress, axtAddress]   (selling NO tokens for AXT)
 *
 * Usage:
 *   RPC_URL=https://polygon-rpc.com \
 *   node predictSell.js <privateKey> <outcomeTokenAddress> <tokenAmountToSell> <minAxtOut>
 *
 * Example (sell 10 YES tokens, accept at least 9.5 AXT back):
 *   RPC_URL=https://polygon-rpc.com \
 *   node predictSell.js 0xPRIVKEY 0xYES_TOKEN_ADDR 10 9.5
 */

'use strict';

const { ethers } = require('ethers');
const { parseError } = require('../parseError');
const { gasLog } = require('../gasLog');

const log = require('debug')(`e2e:${require('path').basename(__filename, '.js')}`);

const APT_ROUTER_ADDRESS = '0x5617604ba0a30e0ff1d2163ab94e50d8b6d0b0df';
const AXT_ADDRESS = '0x840195888db4d6a99ed9f73fcd3b225bb3cb1a79';

const APT_ROUTER_ABI = [
    'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
    'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)',
];

const ERC20_ABI = [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
];

async function predictSell({
    wallet,
    outcomeTokenAddress,   // YES or NO token address
    tokenAmountToSell,     // How many outcome tokens to sell (human-readable)
    minAxtOut = 0,         // Minimum AXT to receive back (slippage guard)
}) {
    log({ address: wallet.address, outcomeTokenAddress, tokenAmountToSell, minAxtOut });

    const router = new ethers.Contract(APT_ROUTER_ADDRESS, APT_ROUTER_ABI, wallet);
    const outcomeToken = new ethers.Contract(outcomeTokenAddress, ERC20_ABI, wallet);

    const amountIn = ethers.utils.parseEther(`${tokenAmountToSell}`);
    const amountOutMin = ethers.utils.parseEther(`${minAxtOut}`);
    const path = [outcomeTokenAddress, AXT_ADDRESS];

    // 1) Check/set allowance
    const currentAllowance = await outcomeToken.allowance(wallet.address, APT_ROUTER_ADDRESS);
    if (currentAllowance.lt(amountIn)) {
        log('Approving APTRouter to spend outcome tokens...');
        const approveTx = await outcomeToken.approve(APT_ROUTER_ADDRESS, ethers.constants.MaxUint256).catch(parseError);
        await approveTx.wait();
        log('Approved.');
    }

    // 2) Preview amounts out
    const amountsOut = await router.getAmountsOut(amountIn, path).catch(parseError);
    log('Expected AXT out:', ethers.utils.formatEther(amountsOut[1]));

    // 3) Swap
    const deadline = Math.floor(Date.now() / 1000) + 5 * 60;
    const args = [amountIn, amountOutMin, path, wallet.address, deadline];

    const gasLimit = await router.estimateGas.swapExactTokensForTokens(...args).catch(parseError);
    const tx = await router.swapExactTokensForTokens(...args, { gasLimit: gasLimit.mul(2) }).catch(parseError);
    const receipt = await tx.wait().then((txn) => {
        log(txn.events);
        return txn;
    }, parseError);

    gasLog({ action: 'APTRouter.swapExactTokensForTokens (sell outcome)', log })({ receipt });
    return receipt;
}

module.exports = { predictSell };

if (require.main === module) {
    require('../inspect');
    const [privateKey, outcomeTokenAddress, tokenAmountToSell, minAxtOut] = process.argv.slice(2);
    const provider = new ethers.providers.JsonRpcProvider(
        process.env.RPC_URL || 'https://polygon-rpc.com'
    );
    const wallet = new ethers.Wallet(privateKey, provider);
    predictSell({ wallet, outcomeTokenAddress, tokenAmountToSell, minAxtOut: minAxtOut || 0 })
        .then((data) => console.log(JSON.stringify(data, null, 2)));
}
