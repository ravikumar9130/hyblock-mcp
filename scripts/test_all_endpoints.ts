import fs from "fs";
import path from "path";

const envContent = fs.readFileSync(".env", "utf8");
const envVars = Object.fromEntries(
    envContent.split("\n")
        .map(line => line.trim())
        .filter(line => line && !line.startsWith("#") && line.includes("="))
        .map(line => {
            const [key, ...rest] = line.split("=");
            return [key.trim(), rest.join("=").trim()];
        })
);

import { createApiClient } from "../src/auth.js";
import * as H from "../src/hyblock.js";

const CLIENT_ID = envVars.HYBLOCK_CLIENT_ID || "";
const CLIENT_SECRET = envVars.HYBLOCK_CLIENT_SECRET || "";
const API_KEY = envVars.HYBLOCK_API_KEY || "";

async function main() {
    const client = await createApiClient(CLIENT_ID, CLIENT_SECRET, API_KEY);

    if (process.argv.includes("--catalog-only")) {
        const catalog = await H.getCatalog(client);
        console.log(JSON.stringify(catalog, null, 2));
        return;
    }

    console.log("Starting endpoint tests...");

    const defaultParams = {
        coin: "btc",
        exchange: "binance_perp_stable",
        timeframe: "1h",
        limit: 5,
    };

    const runTest = async (name: string, fn: any, params: any) => {
        try {
            const result = await fn(client, params);
            console.log(`✅ [SUCCESS] ${name}`);
            return true;
        } catch (err: any) {
            const status = err.response?.status;
            const errMsg = err.response?.data?.error?.message || err.response?.data?.error || err.response?.data?.message || err.message;
            const details = err.response?.data ? JSON.stringify(err.response.data) : "";
            console.log(`❌ [FAILED] ${name} -> ${status}: ${errMsg} | ${details}`);
            return false;
        }
    };

    const results = { passed: 0, failed: 0 };

    // Standard orderflow
    const OFW_TOOLS = [
        H.getKlines, H.getBuyVolume, H.getSellVolume, H.getVolumeDelta, H.getVolumeRatio,
        H.getBotTracker, H.getSlippage, H.getTransferOfContracts, H.getParticipationRatio,
        H.getMarketOrderCount, H.getMarketOrderAverageSize, H.getLimitOrderCount, H.getLimitOrderAverageSize,
        H.getBuySellTradeCountRatio, H.getLimitOrderCountRatio, H.getMarketOrderCountRatio, H.getPdLevels
    ];
    for (const fn of OFW_TOOLS) {
        if (await runTest(fn.name, fn, defaultParams)) results.passed++; else results.failed++;
    }

    // Anchored CVD
    if (await runTest("getAnchoredCVD", H.getAnchoredCVD, { ...defaultParams, anchor: "1h" })) results.passed++; else results.failed++;

    // Exchange Premium
    if (await runTest("getExchangePremium", H.getExchangePremium, {
        coin: "btc", exchange1: "binance_perp_stable", exchange2: "bybit_perp_stable", timeframe: "1h", mode: "standard"
    })) results.passed++; else results.failed++;

    // Funding Rate
    if (await runTest("getFundingRate", H.getFundingRate, { coin: "btc", timeframe: "1h", limit: 5 })) results.passed++; else results.failed++;

    // Sentiment Tools
    const SENTIMENT_TOOLS = [
        H.getTopTraderAccounts, H.getTopTraderPositions, H.getGlobalAccounts, H.getNetLongShort,
        H.getWhaleRetailDelta, H.getTraderSentimentGap
    ];
    for (const fn of SENTIMENT_TOOLS) {
        if (await runTest(fn.name, fn, defaultParams)) results.passed++; else results.failed++;
    }

    // Book Tools
    const BOOK_TOOLS = [
        H.getBidAsk, H.getBidAskRatio, H.getBidAskDelta, H.getMarketImbalanceIndex
    ];
    for (const fn of BOOK_TOOLS) {
        if (await runTest(fn.name, fn, defaultParams)) results.passed++; else results.failed++;
    }
    if (await runTest("getCombinedBook", H.getCombinedBook, { coin: "btc", timeframe: "1h" })) results.passed++; else results.failed++;

    // Global Schema
    if (await runTest("getGlobalBidAskRatio", H.getGlobalBidAskRatio, { coin: "btc", timeframe: "1h" })) results.passed++; else results.failed++;
    if (await runTest("getGlobalCombinedBook", H.getGlobalCombinedBook, { coin: "btc", timeframe: "1h" })) results.passed++; else results.failed++;

    // Open Interest
    if (await runTest("getOpenInterest", H.getOpenInterest, { coin: "btc", timeframe: "1h" })) results.passed++; else results.failed++;
    if (await runTest("getOpenInterestDelta", H.getOpenInterestDelta, { coin: "btc", timeframe: "1h" })) results.passed++; else results.failed++;

    // Volatility
    if (await runTest("getBvol", H.getBvol, defaultParams)) results.passed++; else results.failed++;
    if (await runTest("getDvol", H.getDvol, { ...defaultParams, exchange: "deribit_perp_stable" })) results.passed++; else results.failed++;

    // Liq Tools
    const LIQ_TOOLS = [
        H.getLiquidation, H.getLiqLevelsCount, H.getLiqLevelsSize, H.getLiquidationHeatmap
    ];
    for (const fn of LIQ_TOOLS) {
        let params: any = defaultParams;
        if (fn.name === "getLiquidationHeatmap") params = { coin: "btc", exchange: "binance_perp_stable", leverage: "l1" };
        if (await runTest(fn.name, fn, params)) results.passed++; else results.failed++;
    }

    // Ext tools
    const EXT_TOOLS = [
        H.getNetLongShortDelta, H.getTrueRetailLongShort,
        H.getBidAskRatioDiff, H.getBidsIncreaseDecrease,
        H.getAsksIncreaseDecrease, H.getBestBidAsk, H.getLiquidationLevelsTV,
        H.getTopTraderMarginUsed, H.getTopTraderMarginUsedDelta,
        H.getLiquidationLevels, H.getCumulativeLiqLevel
    ];
    for (const fn of EXT_TOOLS) {
        let params: any = defaultParams;
        if (fn.name.includes("MarginUsed")) params = { ...defaultParams, exchange: "okx_perp_coin" };
        if (fn.name.includes("LiquidationLevels") || fn.name === "getCumulativeLiqLevel") params = { coin: "btc", exchange: "binance_perp_stable", leverage: "high" };
        if (await runTest(fn.name, fn, params)) results.passed++; else results.failed++;
    }

    // Anchor tools
    const ANCHOR_TOOLS = [
        H.getAnchoredTopTraderAccounts, H.getAnchoredTopTraderPositions, H.getAnchoredGlobalAccounts,
        H.getAnchoredWhaleRetailDelta
    ];
    for (const fn of ANCHOR_TOOLS) {
        if (await runTest(fn.name, fn, { ...defaultParams, anchor: "1h" })) results.passed++; else results.failed++;
    }

    // Global specific
    const SPEC_GLOBAL_TOOLS = [
        H.getGlobalBidAsk, H.getGlobalBidAskDelta, H.getGlobalBidAskRatioIncreaseDecrease,
        H.getGlobalBidsIncreaseDecrease, H.getGlobalAsksIncreaseDecrease
    ];
    for (const fn of SPEC_GLOBAL_TOOLS) {
        if (await runTest(fn.name, fn, { coin: "btc", timeframe: "1h" })) results.passed++; else results.failed++;
    }

    // Global misc tools
    if (await runTest("getLeaderboardNotionalProfit", H.getLeaderboardNotionalProfit, { limit: 5, timeframe: "1d" })) results.passed++; else results.failed++;
    if (await runTest("getWbtcMintBurn", H.getWbtcMintBurn, { limit: 5, timeframe: "1d" })) results.passed++; else results.failed++;

    // System tools
    if (await runTest("ping", H.ping, {})) results.passed++; else results.failed++;
    if (await runTest("getCatalog", H.getCatalog, {})) results.passed++; else results.failed++;
    if (await runTest("getDataAvailability", H.getDataAvailability, { endpointName: "klines", coin: "btc", exchange: "binance_perp_stable" })) results.passed++; else results.failed++;

    console.log(`\nResults: ${results.passed} passed, ${results.failed} failed.`);
}

main().catch(console.error);
