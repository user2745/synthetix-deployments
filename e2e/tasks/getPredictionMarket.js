#!/usr/bin/env node
/**
 * getPredictionMarket.js — Read-only inspection of a prediction market.
 *
 * Prints:
 *   - YES token address & price (in AXT)
 *   - NO token address & price (in AXT)
 *   - Your YES balance
 *   - Your NO balance
 *   - Your AXT balance
 *   - Liquidity pair address from APTFactory (YES/AXT and NO/AXT)
 *
 * Usage:
 *   RPC_URL=https://polygon-rpc.com \
 *   node getPredictionMarket.js <walletAddress> <marketAddress>
 *
 * Example:
 *   RPC_URL=https://polygon-rpc.com \
 *   node getPredictionMarket.js 0xYOUR_ADDR 0xMARKET_ADDR
 */

'use strict';

const { ethers } = require('ethers');

const log = require('debug')(`e2e:${require('path').basename(__filename, '.js')}`);

const APT_ROUTER_ADDRESS = '0x5617604ba0a30e0ff1d2163ab94e50d8b6d0b0df';
const APT_FACTORY_ADDRESS = '0x5617604ba0a30e0ff1d2163ab94e50d8b6d0b0df'; // same proxy on SX/Polygon
const AXT_ADDRESS = '0x840195888db4d6a99ed9f73fcd3b225bb3cb1a79';

const EVENT_MARKET_ABI = [
    'function yesToken() external view returns (address)',
    'function noToken() external view returns (address)',
];

const APT_ROUTER_ABI = [
    'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory)',
    'function factory() external view returns (address)',
];

const APT_FACTORY_ABI = [
    'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];

const ERC20_ABI = [
    'function balanceOf(address account) external view returns (uint256)',
    'function name() external view returns (string)',
    'function symbol() external view returns (string)',
];

const UNIT = ethers.utils.parseEther('1');

async function getPredictionMarket({ provider, walletAddress, marketAddress }) {
    const market = new ethers.Contract(marketAddress, EVENT_MARKET_ABI, provider);
    const router = new ethers.Contract(APT_ROUTER_ADDRESS, APT_ROUTER_ABI, provider);

    const [yesAddr, noAddr] = await Promise.all([
        market.yesToken(),
        market.noToken(),
    ]);

    const [yesToken, noToken, axt] = [
        new ethers.Contract(yesAddr, ERC20_ABI, provider),
        new ethers.Contract(noAddr, ERC20_ABI, provider),
        new ethers.Contract(AXT_ADDRESS, ERC20_ABI, provider),
    ];

    // Get prices: 1 AXT → how many YES/NO tokens
    const [yesPriceArr, noPriceArr] = await Promise.all([
        router.getAmountsOut(UNIT, [AXT_ADDRESS, yesAddr]).catch(() => [UNIT, ethers.BigNumber.from(0)]),
        router.getAmountsOut(UNIT, [AXT_ADDRESS, noAddr]).catch(() => [UNIT, ethers.BigNumber.from(0)]),
    ]);

    // Balances
    const [yesBalance, noBalance, axtBalance] = await Promise.all([
        yesToken.balanceOf(walletAddress).catch(() => ethers.BigNumber.from(0)),
        noToken.balanceOf(walletAddress).catch(() => ethers.BigNumber.from(0)),
        axt.balanceOf(walletAddress).catch(() => ethers.BigNumber.from(0)),
    ]);

    // Factory pair addresses
    const factoryAddress = await router.factory().catch(() => null);
    const factory = factoryAddress
        ? new ethers.Contract(factoryAddress, APT_FACTORY_ABI, provider)
        : null;

    const [yesPairAddress, noPairAddress] = factory
        ? await Promise.all([
            factory.getPair(yesAddr, AXT_ADDRESS).catch(() => ethers.constants.AddressZero),
            factory.getPair(noAddr, AXT_ADDRESS).catch(() => ethers.constants.AddressZero),
        ])
        : [ethers.constants.AddressZero, ethers.constants.AddressZero];

    const result = {
        market: marketAddress,
        axt: {
            address: AXT_ADDRESS,
            balance: ethers.utils.formatEther(axtBalance),
        },
        yesToken: {
            address: yesAddr,
            price_axt_per_yes: ethers.utils.formatEther(yesPriceArr[1] || 0),  // YES tokens received per 1 AXT
            balance: ethers.utils.formatEther(yesBalance),
            amm_pair: yesPairAddress,
        },
        noToken: {
            address: noAddr,
            price_axt_per_no: ethers.utils.formatEther(noPriceArr[1] || 0),
            balance: ethers.utils.formatEther(noBalance),
            amm_pair: noPairAddress,
        },
    };

    return result;
}

module.exports = { getPredictionMarket };

if (require.main === module) {
    require('../inspect');
    const [walletAddress, marketAddress] = process.argv.slice(2);
    if (!walletAddress || !marketAddress) {
        console.error('Usage: node getPredictionMarket.js <walletAddress> <marketAddress>');
        process.exit(1);
    }
    const provider = new ethers.providers.JsonRpcProvider(
        process.env.RPC_URL || 'https://polygon-rpc.com'
    );
    getPredictionMarket({ provider, walletAddress, marketAddress })
        .then((data) => console.log(JSON.stringify(data, null, 2)));
}
