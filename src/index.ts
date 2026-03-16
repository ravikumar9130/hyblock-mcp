#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { z } from "zod";
import crypto from "crypto";
import "dotenv/config";

import { createApiClient } from "./auth.js";
import * as H from "./hyblock.js";

const CLIENT_ID = process.env.HYBLOCK_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.HYBLOCK_CLIENT_SECRET ?? "";
const API_KEY = process.env.HYBLOCK_API_KEY ?? "";
const PORT = process.env.PORT || "3000";

const HAS_CREDS = !!(CLIENT_ID && CLIENT_SECRET && API_KEY);

if (!HAS_CREDS) {
    console.error("Error: HYBLOCK_CLIENT_ID, HYBLOCK_CLIENT_SECRET, and HYBLOCK_API_KEY must be set.");
    process.exit(1);
}

function getClient() {
    return createApiClient(CLIENT_ID, CLIENT_SECRET, API_KEY);
}

function normalizeParams<T>(args: any): T {
    const p = { ...args };

    if (p.symbol && !p.coin) p.coin = p.symbol;
    if (p.coin) {
        p.coin = p.coin.toLowerCase();
        p.coin = p.coin.replace(/usdt$|perp$/i, "");
    }

    if (p.interval && !p.timeframe) p.timeframe = p.interval;
    if (!p.timeframe && (p.coin || p.exchange)) p.timeframe = "1h";

    if (p.anchorTime && !p.anchor) p.anchor = p.anchorTime;

    const mapExchange = (ex: string) => {
        ex = ex.toLowerCase();
        if (ex.includes("_")) return ex;
        if (ex === "binance") return "binance_perp_stable";
        if (ex === "bybit") return "bybit_perp_stable";
        if (ex === "okx") return "okx_perp_stable";
        if (ex === "dydx") return "dydx_perp_stable";
        if (ex === "gate") return "gate_perp_stable";
        if (ex === "deribit") return "deribit_perp_stable";
        if (ex === "bitmex") return "bitmex_perp_stable";
        return ex;
    };
    if (p.exchange) p.exchange = mapExchange(p.exchange);
    if (p.exchange1) p.exchange1 = mapExchange(p.exchange1);
    if (p.exchange2) p.exchange2 = mapExchange(p.exchange2);

    if (p.mode) {
        if (p.mode === "standard" || p.mode === "price") p.mode = "standard";
        else if (p.mode === "percentage" || p.mode === "percent") p.mode = "percentage";
    }

    delete p.symbol;
    delete p.interval;
    delete p.anchorTime;

    return p as T;
}

async function toolHandler(fn: Function, args: any, endpoint?: string) {
    try {
        const client = await getClient();
        const params = normalizeParams(args);

        const name = endpoint?.toLowerCase();
        if (name?.includes("liq") || name?.includes("heatmap")) {
            delete (params as any).timeframe;
            delete (params as any).limit;
        }

        const data = await fn(client, params);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    } catch (error: any) {
        const status = error.response?.status;
        const errMsg =
            error.response?.data?.error?.message ||
            error.response?.data?.error ||
            error.response?.data?.message ||
            error.message;
        const details = error.response?.data ? JSON.stringify(error.response.data) : "";

        let hint = "";
        if (status === 401 || status === 403) {
            hint = "\nHint: Check that HYBLOCK_CLIENT_ID, HYBLOCK_CLIENT_SECRET, and HYBLOCK_API_KEY are correctly set.";
        }

        return {
            content: [{
                type: "text" as const,
                text: `Error (${status || "Unknown"}): ${errMsg}. ${details ? `\nDetails: ${details}` : ""}${hint}`
            }],
            isError: true
        };
    }
}

const CommonSchema = {
    coin: z.string().describe("Coin symbol (e.g. btc, eth)."),
    exchange: z.string().describe("Exchange identifier (e.g. binance_perp_stable, bybit_perp_stable)."),
    timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).describe("Required candle timeframe."),
    limit: z.coerce.number().optional(),
    startTime: z.coerce.number().optional(),
    endTime: z.coerce.number().optional(),
    sort: z.enum(["asc", "desc"]).optional(),
};

const CoinTimeframeSchema = {
    coin: z.string().describe("Coin symbol (e.g. btc, eth)."),
    timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).describe("Required candle timeframe."),
    limit: z.coerce.number().optional(),
    startTime: z.coerce.number().optional(),
    endTime: z.coerce.number().optional(),
    sort: z.enum(["asc", "desc"]).optional(),
};

const AnchorSchema = {
    ...CommonSchema,
    anchor: z.enum(["1h", "4h", "1d"]).describe("Aggregation interval for anchored calculations."),
};

const LIQ_LVL_SCHEMA = {
    coin: z.string(),
    exchange: z.string(),
    timestamp: z.coerce.number().optional(),
    leverage: z.enum(["all", "high", "medium", "low"]).optional(),
    position: z.enum(["long", "short"]).optional(),
};

const HEATMAP_SCHEMA = {
    coin: z.string(),
    exchange: z.string(),
    lookback: z.coerce.number().optional(),
    leverage: z.enum(["l1", "l2", "l3", "l4", "l5", "all"]).optional(),
};

const server = new McpServer({
    name: "hyblock-mcp-server",
    version: "1.0.0"
});

server.registerTool("hyblock_ping", z.object({}).describe("Check Hyblock API health."), async () => toolHandler(H.ping, {}));
server.registerTool("hyblock_catalog", z.object({}).describe("Discovery for available coins/exchanges."), async () => toolHandler(H.getCatalog, {}));
server.registerTool("hyblock_data_availability", z.object({
    endpointName: z.string().describe("e.g. klines"),
    coin: z.string(),
    exchange: z.string().optional(),
}).describe("Check historical range."), async (args: any) => toolHandler(H.getDataAvailability, args));

[
    { name: "hyblock_klines", fn: H.getKlines },
    { name: "hyblock_buy_volume", fn: H.getBuyVolume },
    { name: "hyblock_sell_volume", fn: H.getSellVolume },
    { name: "hyblock_volume_delta", fn: H.getVolumeDelta },
    { name: "hyblock_volume_ratio", fn: H.getVolumeRatio },
    { name: "hyblock_bot_tracker", fn: H.getBotTracker },
    { name: "hyblock_slippage", fn: H.getSlippage },
    { name: "hyblock_transfer_of_contracts", fn: H.getTransferOfContracts },
    { name: "hyblock_participation_ratio", fn: H.getParticipationRatio },
    { name: "hyblock_market_order_count", fn: H.getMarketOrderCount },
    { name: "hyblock_market_order_average_size", fn: H.getMarketOrderAverageSize },
    { name: "hyblock_limit_order_count", fn: H.getLimitOrderCount },
    { name: "hyblock_limit_order_average_size", fn: H.getLimitOrderAverageSize },
    { name: "hyblock_buy_sell_trade_count_ratio", fn: H.getBuySellTradeCountRatio },
    { name: "hyblock_limit_order_count_ratio", fn: H.getLimitOrderCountRatio },
    { name: "hyblock_market_order_count_ratio", fn: H.getMarketOrderCountRatio },
    { name: "hyblock_pd_levels", fn: H.getPdLevels },
].forEach(t => server.registerTool(t.name, z.object(CommonSchema).describe(t.name), async (args: any) => toolHandler(t.fn, args, t.name.replace("hyblock_", ""))));

server.registerTool("hyblock_anchored_cvd", z.object(AnchorSchema).describe("Anchored CVD."), async (args: any) => toolHandler(H.getAnchoredCVD, args, "anchoredCVD"));
server.registerTool("hyblock_exchange_premium", z.object({
    coin: z.string(),
    exchange1: z.string(),
    exchange2: z.string(),
    timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
    mode: z.enum(["standard", "percentage"]),
}).describe("Exchange premium."), async (args: any) => toolHandler(H.getExchangePremium, args));

server.registerTool("hyblock_funding_rate", z.object(CoinTimeframeSchema).describe("Funding rate."), async (args: any) => toolHandler(H.getFundingRate, args, "fundingRate"));

[
    { name: "hyblock_top_trader_accounts", fn: H.getTopTraderAccounts },
    { name: "hyblock_top_trader_positions", fn: H.getTopTraderPositions },
    { name: "hyblock_global_accounts", fn: H.getGlobalAccounts },
    { name: "hyblock_net_long_short", fn: H.getNetLongShort },
    { name: "hyblock_whale_retail_delta", fn: H.getWhaleRetailDelta },
    { name: "hyblock_trader_sentiment_gap", fn: H.getTraderSentimentGap },
].forEach(t => server.registerTool(t.name, z.object(CommonSchema).describe(t.name), async (args: any) => toolHandler(t.fn, args, t.name.replace("hyblock_", ""))));

server.registerTool("hyblock_combined_book", z.object(CoinTimeframeSchema).describe("Combined book."), async (args: any) => toolHandler(H.getCombinedBook, args));
[
    { name: "hyblock_bid_ask", fn: H.getBidAsk },
    { name: "hyblock_bid_ask_ratio", fn: H.getBidAskRatio },
    { name: "hyblock_bid_ask_delta", fn: H.getBidAskDelta },
    { name: "hyblock_market_imbalance_index", fn: H.getMarketImbalanceIndex },
].forEach(t => server.registerTool(t.name, z.object(CommonSchema).describe(t.name), async (args: any) => toolHandler(t.fn, args, t.name.replace("hyblock_", ""))));

server.registerTool("hyblock_global_bid_ask_ratio", z.object(CoinTimeframeSchema).describe("Global BA ratio."), async (args: any) => toolHandler(H.getGlobalBidAskRatio, args));
server.registerTool("hyblock_global_combined_book", z.object(CoinTimeframeSchema).describe("Global combined book."), async (args: any) => toolHandler(H.getGlobalCombinedBook, args));

server.registerTool("hyblock_open_interest", z.object(CoinTimeframeSchema).describe("OI."), async (args: any) => toolHandler(H.getOpenInterest, args));
server.registerTool("hyblock_open_interest_delta", z.object(CoinTimeframeSchema).describe("OI delta."), async (args: any) => toolHandler(H.getOpenInterestDelta, args));

server.registerTool("hyblock_bvol", z.object(CommonSchema).describe("BVOL."), async (args: any) => toolHandler(H.getBvol, args));
server.registerTool("hyblock_dvol", z.object(CommonSchema).describe("DVOL."), async (args: any) => toolHandler(H.getDvol, args));

server.registerTool("hyblock_margin_lending_ratio", z.object(CommonSchema).describe("Margin lending ratio."), async (args: any) => toolHandler(H.getMarginLendingRatio, args));
server.registerTool("hyblock_user_bot_ratio", z.object(CommonSchema).describe("User bot ratio."), async (args: any) => toolHandler(H.getUserBotRatio, args));

server.registerTool("hyblock_liquidation", z.object(CommonSchema).describe("Liquidations."), async (args: any) => toolHandler(H.getLiquidation, args));
server.registerTool("hyblock_liq_levels_count", z.object(CommonSchema).describe("Liq levels count."), async (args: any) => toolHandler(H.getLiqLevelsCount, args));
server.registerTool("hyblock_liq_levels_size", z.object(CommonSchema).describe("Liq levels size."), async (args: any) => toolHandler(H.getLiqLevelsSize, args));
server.registerTool("hyblock_liquidation_heatmap", z.object(HEATMAP_SCHEMA).describe("Heatmap."), async (args: any) => toolHandler(H.getLiquidationHeatmap, args, "liquidationHeatmap"));

[
    { name: "hyblock_net_long_short_delta", fn: H.getNetLongShortDelta },
    { name: "hyblock_true_retail_long_short", fn: H.getTrueRetailLongShort },
    { name: "hyblock_bid_ask_ratio_diff", fn: H.getBidAskRatioDiff },
    { name: "hyblock_bids_increase_decrease", fn: H.getBidsIncreaseDecrease },
    { name: "hyblock_asks_increase_decrease", fn: H.getAsksIncreaseDecrease },
    { name: "hyblock_best_bid_ask", fn: H.getBestBidAsk },
    { name: "hyblock_top_trader_margin_used", fn: H.getTopTraderMarginUsed },
    { name: "hyblock_top_trader_margin_used_delta", fn: H.getTopTraderMarginUsedDelta },
].forEach(t => server.registerTool(t.name, z.object(CommonSchema).describe(t.name), async (args: any) => toolHandler(t.fn, args, t.name.replace("hyblock_", ""))));

server.registerTool("hyblock_liquidation_levels_tv", z.object(LIQ_LVL_SCHEMA).describe("Liq levels TV."), async (args: any) => toolHandler(H.getLiquidationLevelsTV, args, "liquidationLevelsTV"));
server.registerTool("hyblock_liquidation_levels", z.object(LIQ_LVL_SCHEMA).describe("Liq levels."), async (args: any) => toolHandler(H.getLiquidationLevels, args, "liquidationLevels"));
server.registerTool("hyblock_cumulative_liq_level", z.object(LIQ_LVL_SCHEMA).describe("Cumulative liq level."), async (args: any) => toolHandler(H.getCumulativeLiqLevel, args, "cumulativeLiqLevel"));

[
    { name: "hyblock_anchored_top_trader_accounts", fn: H.getAnchoredTopTraderAccounts },
    { name: "hyblock_anchored_top_trader_positions", fn: H.getAnchoredTopTraderPositions },
    { name: "hyblock_anchored_global_accounts", fn: H.getAnchoredGlobalAccounts },
    { name: "hyblock_anchored_whale_retail_delta", fn: H.getAnchoredWhaleRetailDelta },
].forEach(t => server.registerTool(t.name, z.object(AnchorSchema).describe(t.name), async (args: any) => toolHandler(t.fn, args, t.name.replace("hyblock_", ""))));

[
    { name: "hyblock_global_bid_ask", fn: H.getGlobalBidAsk },
    { name: "hyblock_global_bid_ask_delta", fn: H.getGlobalBidAskDelta },
    { name: "hyblock_global_bid_ask_ratio_increase_decrease", fn: H.getGlobalBidAskRatioIncreaseDecrease },
    { name: "hyblock_global_bids_increase_decrease", fn: H.getGlobalBidsIncreaseDecrease },
    { name: "hyblock_global_asks_increase_decrease", fn: H.getGlobalAsksIncreaseDecrease },
].forEach(t => server.registerTool(t.name, z.object(CoinTimeframeSchema).describe(t.name), async (args: any) => toolHandler(t.fn, args, t.name.replace("hyblock_", ""))));

server.registerTool("hyblock_leaderboard_notional_profit", z.object({
    timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
    limit: z.coerce.number().optional()
}).describe("Leaderboard."), async (args: any) => toolHandler(H.getLeaderboardNotionalProfit, args, "leaderboardNotionalProfit"));

server.registerTool("hyblock_wbtc_mint_burn", z.object({
    timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
    limit: z.coerce.number().optional()
}).describe("WBTC Mint/Burn."), async (args: any) => toolHandler(H.getWbtcMintBurn, args, "wbtcMintBurn"));

async function main() {
    if (PORT) {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
        });

        const httpServer = createServer(async (req, res) => {
            if (req.method === "GET" && req.url === "/health") {
                res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok" }));
                return;
            }

            let body: any = undefined;
            if (req.method === "POST" && req.url === "/messages") {
                body = await new Promise((resolve) => {
                    let data = "";
                    req.on("data", chunk => data += chunk);
                    req.on("end", () => {
                        try { resolve(JSON.parse(data)); } catch { resolve(undefined); }
                    });
                });
            }

            try {
                await transport.handleRequest(req, res, body);
            } catch (err) {
                console.error("Transport error:", err);
                if (!res.headersSent) res.writeHead(500).end();
            }
        });

        await server.connect(transport);
        httpServer.listen(Number(PORT), "0.0.0.0", () => {
            console.log(`Hyblock MCP Server v1.0.0 listening on port ${PORT}`);
        });
    } else {
        const transport = new StdioServerTransport();
        await server.connect(transport);
    }
}

main().catch(console.error);
