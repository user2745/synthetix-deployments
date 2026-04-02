#!/usr/bin/env node
/**
 * predictBuy.js — Buy YES or NO outcome tokens on a prediction market.
 *
 * How it works:
 *   aptRouter.swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline)
 *   where path = [axtAddress, yesTokenAddress]  (for YES)
 *              = [axtAddress, noTokenAddress]   (for NO)
 *
 * Usage:
 *   RPC_URL=https://polygon-rpc.com \
 *   node predictBuy.js <privateKey> <yesOrNoTokenAddress> <axtAmountIn> <minTokensOut>
 *
 * Example (buy YES tokens with 5 AXT, accept at least 4.9 YES tokens):
 *   RPC_URL=https://polygon-rpc.com \
 *   node predictBuy.js 0xPRIVKEY 0xYES_TOKEN_ADDR 5 4.9
 */

'use strict';

const { ethers } = require('ethers');
const { parseError } = require('../parseError');
const { gasLog } = require('../gasLog');

const log = require('debug')(`e2e:${require('path').basename(__filename, '.js')}`);

// Deployed addresses (Polygon Mainnet)
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

async function predictBuy({
    wallet,
    outcomeTokenAddress,  // YES or NO token address for the prediction market
    axtAmountIn,          // How many AXT to spend (human-readable, e.g. 5)
    minTokensOut = 0,     // Minimum outcome tokens to receive (slippage guard)
}) {
    log({ address: wallet.address, outcomeTokenAddress, axtAmountIn, minTokensOut });

    const router = new ethers.Contract(APT_ROUTER_ADDRESS, APT_ROUTER_ABI, wallet);
    const axt = new ethers.Contract(AXT_ADDRESS, ERC20_ABI, wallet);

    const amountIn = ethers.utils.parseEther(`${axtAmountIn}`);
    const amountOutMin = ethers.utils.parseEther(`${minTokensOut}`);
    const path = [AXT_ADDRESS, outcomeTokenAddress];

    // 1) Check/set allowance
    const currentAllowance = await axt.allowance(wallet.address, APT_ROUTER_ADDRESS);
    if (currentAllowance.lt(amountIn)) {
        log('Approving APTRouter to spend AXT...');
        const approveTx = await axt.approve(APT_ROUTER_ADDRESS, ethers.constants.MaxUint256).catch(parseError);
        await approveTx.wait();
        log('Approved.');
    }

    // 2) Preview amounts out
    const amountsOut = await router.getAmountsOut(amountIn, path).catch(parseError);
    log('Expected outcome tokens out:', ethers.utils.formatEther(amountsOut[1]));

    // 3) Swap
    const deadline = Math.floor(Date.now() / 1000) + 5 * 60; // 5 min
    const args = [amountIn, amountOutMin, path, wallet.address, deadline];

    const gasLimit = await router.estimateGas.swapExactTokensForTokens(...args).catch(parseError);
    const tx = await router.swapExactTokensForTokens(...args, { gasLimit: gasLimit.mul(2) }).catch(parseError);
    const receipt = await tx.wait().then((txn) => {
        log(txn.events);
        return txn;
    }, parseError);

    gasLog({ action: 'APTRouter.swapExactTokensForTokens (buy outfit)', log })({ receipt });
    return receipt;
}

module.exports = { predictBuy };

if (require.main === module) {
    require('../inspect');
    const [privateKey, outcomeTokenAddress, axtAmountIn, minTokensOut] = process.argv.slice(2);
    const provider = new ethers.providers.JsonRpcProvider(
        process.env.RPC_URL || 'https://polygon-rpc.com'
    );
    const wallet = new ethers.Wallet(privateKey, provider);
    predictBuy({ wallet, outcomeTokenAddress, axtAmountIn, minTokensOut: minTokensOut || 0 })
        .then((data) => console.log(JSON.stringify(data, null, 2)));
}
