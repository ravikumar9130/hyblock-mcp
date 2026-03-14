#!/usr/bin/env node
/**
 * Hyblock Capital MCP Server
 *
 * Exposes all Hyblock Capital API endpoints as MCP tools.
 * Transport: HTTP (stdio for MCP protocol, HTTP for upstream API calls)
 *
 * Required environment variables:
 *   HYBLOCK_CLIENT_ID     – OAuth2 client ID
 *   HYBLOCK_CLIENT_SECRET – OAuth2 client secret
 *   HYBLOCK_API_KEY       – x-api-key header value
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import express from "express";
import crypto from "crypto";

import { createApiClient } from "./auth.js";
import * as H from "./hyblock.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const CLIENT_ID = process.env.HYBLOCK_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.HYBLOCK_CLIENT_SECRET ?? "";
const API_KEY = process.env.HYBLOCK_API_KEY ?? "";
const PORT = process.env.PORT; // If defined, we use HTTP transport (Railway style)

/**
 * For local stdio usage we fail fast if credentials are missing.
 * For HTTP (Railway/hosted) we still start the server so health checks
 * succeed, but individual tool calls will return upstream auth errors.
 */
const HAS_CREDS = !!(CLIENT_ID && CLIENT_SECRET && API_KEY);

if (!HAS_CREDS && !PORT) {
    console.error(
        "Error: HYBLOCK_CLIENT_ID, HYBLOCK_CLIENT_SECRET, and HYBLOCK_API_KEY must be set."
    );
    process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClient() {
    return createApiClient(CLIENT_ID, CLIENT_SECRET, API_KEY);
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const CommonSchema = {
    coin: z.string().describe("Coin symbol (e.g. BTC, ETH). Must be supported by Hyblock catalog."),
    exchange: z
        .string()
        .describe(
            "Exchange identifier (e.g. binance_perp_stable, bybit_perp_stable). Must be supported by Hyblock catalog."
        ),
    timeframe: z
        .enum(["1m", "5m", "15m", "1h", "4h", "1d"])
        .describe("Required candle timeframe. Hyblock API rejects requests without a timeframe."),
    limit: z
        .number()
        .max(1000)
        .optional()
        .describe(
            "Maximum records to return. Typical values: 50 (default), 100, 500, 1000."
        ),
    startTime: z
        .number()
        .optional()
        .describe("Optional start Unix timestamp (ms). If omitted, Hyblock uses a recent window."),
    endTime: z
        .number()
        .optional()
        .describe("Optional end Unix timestamp (ms)."),
    sort: z
        .enum(["asc", "desc"])
        .optional()
        .describe("Sort order. Default is asc."),
};

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
    name: "hyblock-mcp-server",
    version: "1.0.0"
});

// ─── Tool Registrations ───────────────────────────────────────────────────────

/**
 * System Tools
 */

server.registerTool("hyblock_ping", z.object({}).describe("Check the Hyblock API health/status."), async () => {
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.ping(client), null, 2) }] };
});

server.registerTool("hyblock_catalog", z.object({}).describe("Fetch valid coins, exchanges, and symbols support. Use this first to discover available values."), async () => {
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.getCatalog(client), null, 2) }] };
});

server.registerTool("hyblock_data_availability", z.object({
    endpoint: z.string().describe("API endpoint path (e.g. /klines)"),
    coin: z.string(),
    exchange: z.string(),
}).describe("Check historical data range for an endpoint."), async (args: any) => {
    const { endpoint, coin, exchange } = args;
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.getDataAvailability(client, { endpoint, coin, exchange }), null, 2) }] };
});

/**
 * Orderflow Tools
 */

const OFW_TOOLS = [
    { name: "hyblock_klines", desc: "Get OHLC candlestick price chart data.", fn: H.getKlines },
    { name: "hyblock_buy_volume", desc: "Get aggregated volume from market buy orders.", fn: H.getBuyVolume },
    { name: "hyblock_sell_volume", desc: "Get aggregated volume from market sell orders.", fn: H.getSellVolume },
    { name: "hyblock_volume_delta", desc: "Get market buy-sell volume delta (CVD).", fn: H.getVolumeDelta },
    { name: "hyblock_volume_ratio", desc: "Get market buy-sell volume ratio.", fn: H.getVolumeRatio },
    { name: "hyblock_bot_tracker", desc: "Track algorithmic bot activity.", fn: H.getBotTracker },
    { name: "hyblock_slippage", desc: "Get market slippage data.", fn: H.getSlippage },
    { name: "hyblock_transfer_of_contracts", desc: "Get transfer of contracts data.", fn: H.getTransferOfContracts },
    { name: "hyblock_participation_ratio", desc: "Get market volume participation by group.", fn: H.getParticipationRatio },
    { name: "hyblock_market_order_count", desc: "Get market order counts.", fn: H.getMarketOrderCount },
    { name: "hyblock_market_order_average_size", desc: "Get average market order size.", fn: H.getMarketOrderAverageSize },
    { name: "hyblock_limit_order_count", desc: "Get limit order placement counts.", fn: H.getLimitOrderCount },
    { name: "hyblock_limit_order_average_size", desc: "Get average limit order size.", fn: H.getLimitOrderAverageSize },
    { name: "hyblock_buy_sell_trade_count_ratio", desc: "Get buy/sell trade count ratio.", fn: H.getBuySellTradeCountRatio },
    { name: "hyblock_limit_order_count_ratio", desc: "Get limit order count ratio.", fn: H.getLimitOrderCountRatio },
    { name: "hyblock_market_order_count_ratio", desc: "Get market order count ratio.", fn: H.getMarketOrderCountRatio },
    { name: "hyblock_pd_levels", desc: "Get Prev Day Levels (H/L/O/E).", fn: H.getPdLevels },
];

for (const t of OFW_TOOLS) {
    server.registerTool(t.name, z.object(CommonSchema).describe(t.desc), async (args: any) => {
        const client = await getClient();
        return { content: [{ type: "text", text: JSON.stringify(await t.fn(client, args as H.CommonParams), null, 2) }] };
    });
}

server.registerTool("hyblock_anchored_cvd", z.object({
    ...CommonSchema,
    anchorTime: z.number().describe("Unix timestamp (ms) to anchor calculations."),
}).describe("Get CVD anchored to a specific time."), async (args: any) => {
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.getAnchoredCVD(client, args as any), null, 2) }] };
});

server.registerTool("hyblock_exchange_premium", z.object({
    ...CommonSchema,
    exchangeB: z.string().describe("Second exchange to compare against."),
}).describe("Get price premium between two exchanges."), async (args: any) => {
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.getExchangePremium(client, args as any), null, 2) }] };
});

/**
 * Other Categories
 */

server.registerTool("hyblock_funding_rate", z.object(CommonSchema).describe("Get periodic funding rates."), async (args: any) => {
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.getFundingRate(client, args as H.CommonParams), null, 2) }] };
});

const SENTIMENT_TOOLS = [
    { name: "hyblock_top_trader_accounts", desc: "Top trader accounts L/S ratio.", fn: H.getTopTraderAccounts },
    { name: "hyblock_top_trader_positions", desc: "Top trader positions L/S ratio.", fn: H.getTopTraderPositions },
    { name: "hyblock_global_accounts", desc: "Global L/S account ratios.", fn: H.getGlobalAccounts },
    { name: "hyblock_net_long_short", desc: "Net L/S positions by group.", fn: H.getNetLongShort },
    { name: "hyblock_whale_retail_delta", desc: "Whale vs retail position delta.", fn: H.getWhaleRetailDelta },
    { name: "hyblock_trader_sentiment_gap", desc: "Sentiment gap whale vs retail.", fn: H.getTraderSentimentGap },
];

for (const t of SENTIMENT_TOOLS) {
    server.registerTool(t.name, z.object(CommonSchema).describe(t.desc), async (args: any) => {
        const client = await getClient();
        return { content: [{ type: "text", text: JSON.stringify(await t.fn(client, args as H.CommonParams), null, 2) }] };
    });
}

const BOOK_TOOLS = [
    { name: "hyblock_bid_ask", desc: "Raw bid/ask depth data.", fn: H.getBidAsk },
    { name: "hyblock_bid_ask_ratio", desc: "Total Bids/Asks ratio.", fn: H.getBidAskRatio },
    { name: "hyblock_bid_ask_delta", desc: "Total Bids/Asks delta.", fn: H.getBidAskDelta },
    { name: "hyblock_combined_book", desc: "Combined depth across exchanges.", fn: H.getCombinedBook },
    { name: "hyblock_market_imbalance_index", desc: "Market imbalance sentiment index.", fn: H.getMarketImbalanceIndex },
];

for (const t of BOOK_TOOLS) {
    server.registerTool(t.name, z.object(CommonSchema).describe(t.desc), async (args: any) => {
        const client = await getClient();
        return { content: [{ type: "text", text: JSON.stringify(await t.fn(client, args as H.CommonParams), null, 2) }] };
    });
}

const GLOBAL_SCHEMA = {
    coin: z.string(),
    timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).optional(),
    limit: z.number().optional(),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
    sort: z.enum(["asc", "desc"]).optional(),
};

server.registerTool("hyblock_global_bid_ask_ratio", z.object(GLOBAL_SCHEMA).describe("Global aggregate bid-ask ratio."), async (args: any) => {
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.getGlobalBidAskRatio(client, args as any), null, 2) }] };
});

server.registerTool("hyblock_global_combined_book", z.object(GLOBAL_SCHEMA).describe("Global combined book depth."), async (args: any) => {
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.getGlobalCombinedBook(client, args as any), null, 2) }] };
});

server.registerTool("hyblock_open_interest", z.object(CommonSchema).describe("Total open interest."), async (args: any) => {
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.getOpenInterest(client, args as H.CommonParams), null, 2) }] };
});

server.registerTool("hyblock_open_interest_delta", z.object(CommonSchema).describe("Open interest delta."), async (args: any) => {
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.getOpenInterestDelta(client, args as H.CommonParams), null, 2) }] };
});

const VOL_SCHEMA = {
    timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).optional(),
    limit: z.number().optional(),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
    sort: z.enum(["asc", "desc"]).optional(),
};

server.registerTool("hyblock_bvol", z.object(VOL_SCHEMA).describe("Binance Volatility Index (BVOL)."), async (args: any) => {
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.getBvol(client, args as any), null, 2) }] };
});

server.registerTool("hyblock_dvol", z.object(VOL_SCHEMA).describe("Deribit Volatility Index (DVOL)."), async (args: any) => {
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.getDvol(client, args as any), null, 2) }] };
});

server.registerTool("hyblock_margin_lending_ratio", z.object(CommonSchema).describe("Margin lending ratio."), async (args: any) => {
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.getMarginLendingRatio(client, args as H.CommonParams), null, 2) }] };
});

server.registerTool("hyblock_fear_and_greed_index", z.object({
    limit: z.number().optional(),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
    sort: z.enum(["asc", "desc"]).optional(),
}).describe("Market Fear & Greed Index."), async (args: any) => {
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.getFearAndGreedIndex(client, args as any), null, 2) }] };
});

server.registerTool("hyblock_user_bot_ratio", z.object(CommonSchema).describe("Human user vs bot ratio."), async (args: any) => {
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.getUserBotRatio(client, args as H.CommonParams), null, 2) }] };
});

const LIQ_TOOLS = [
    { name: "hyblock_liquidation", desc: "Historical liquidation events.", fn: H.getLiquidation },
    { name: "hyblock_liq_levels_count", desc: "Count of predicted liq levels.", fn: H.getLiqLevelsCount },
    { name: "hyblock_liq_levels_size", desc: "Size of predicted liq levels.", fn: H.getLiqLevelsSize },
    { name: "hyblock_liquidation_heatmap", desc: "Liquidation heatmap clusters.", fn: H.getLiquidationHeatmap },
    { name: "hyblock_avg_leverage_used", desc: "Average leverage used in market.", fn: H.getAvgLeverageUsed },
];

for (const t of LIQ_TOOLS) {
    server.registerTool(t.name, z.object(CommonSchema).describe(t.desc), async (args: any) => {
        const client = await getClient();
        return { content: [{ type: "text", text: JSON.stringify(await t.fn(client, args as H.CommonParams), null, 2) }] };
    });
}

server.registerTool("hyblock_indicator_profile", z.object({
    indicator: z.string(),
    coin: z.string(),
    exchange: z.string(),
    timeframe: z.string().optional(),
}).describe("Backtest indicator performance profiles."), async (args: any) => {
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.getIndicatorProfile(client, args as any), null, 2) }] };
});

server.registerTool("hyblock_coin_profile", z.object({
    coin: z.string(),
    exchange: z.string(),
}).describe("Coin statistics and profile."), async (args: any) => {
    const client = await getClient();
    return { content: [{ type: "text", text: JSON.stringify(await H.getCoinProfile(client, args as any), null, 2) }] };
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
    if (PORT) {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
        });
        const app = express();
        app.use(express.json());

        app.get("/", (req, res) => {
            res.send("Hyblock Capital MCP Server is running. Use /sse and /messages for MCP.");
        });

        app.get("/sse", async (req, res, next) => {
            try {
                await transport.handleRequest(req, res);
            } catch (err) {
                next(err);
            }
        });

        app.post("/messages", async (req, res, next) => {
            try {
                await transport.handleRequest(req, res, req.body);
            } catch (err) {
                next(err);
            }
        });

        // Global error handler
        app.use((err: any, req: any, res: any, next: any) => {
            console.error("MCP Server Error:", err);
            res.status(500).json({
                jsonrpc: "2.0",
                error: {
                    code: -32000,
                    message: err.message || "Internal Server Error"
                },
                id: null
            });
        });

        await server.connect(transport);

        const port = parseInt(PORT);
        app.listen(port, "0.0.0.0", () => {
            console.error(`Hyblock Capital MCP Server running on port ${port} (HTTP)`);
        });
    } else {
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("Hyblock Capital MCP Server running on stdio");
    }
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
