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
import cors from "cors";
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

function normalizeParams<T>(args: any): T {
    const p = { ...args };

    // Handle symbols/coins
    if (p.symbol && !p.coin) p.coin = p.symbol;
    if (p.coin) {
        p.coin = p.coin.toLowerCase();
        // Remove 'usdt' or 'perp' suffix if AI adds it (e.g. BTCUSDT -> btc)
        p.coin = p.coin.replace(/usdt$|perp$/i, "");
    }

    // Handle timeframes
    if (p.interval && !p.timeframe) p.timeframe = p.interval;
    if (!p.timeframe && (p.coin || p.exchange)) p.timeframe = "1h"; // sensible default

    // Mapping for common exchange names/aliases
    if (p.exchange) {
        const ex = p.exchange.toLowerCase();
        if (ex.includes("binance")) p.exchange = "binance_perp_stable";
        else if (ex.includes("bybit")) p.exchange = "bybit_perp_stable";
        else if (ex.includes("okx")) p.exchange = "okx_perp_stable";
        else if (ex.includes("dydx")) p.exchange = "dydx_perp_stable";
        else if (ex.includes("gate")) p.exchange = "gate_perp_stable";
        else if (ex.includes("deribit")) p.exchange = "deribit_perp_stable";
        else if (ex.includes("bitmex")) p.exchange = "bitmex_perp_stable";
    }

    // Stripping disallowed fields (Hyblock v2 API is strict)
    delete p.symbol;
    delete p.interval;

    return p as T;
}

/**
 * Enhanced tool wrapper to provide better error messages to the AI
 */
async function toolHandler(fn: Function, args: any) {
    try {
        const client = await getClient();
        const params = normalizeParams(args);
        console.log(`Executing tool: ${fn.name} with params:`, params);
        const data = await fn(client, params);
        console.log(`Tool ${fn.name} success.`);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    } catch (error: any) {
        const status = error.response?.status;
        const errMsg = error.response?.data?.error?.message || error.response?.data?.error || error.response?.data?.message || error.message;
        const details = error.response?.data ? JSON.stringify(error.response.data) : "";

        console.error(`Tool Execution Error [${fn.name}]:`, errMsg, details);
        return {
            content: [{
                type: "text" as const,
                text: `❌ API Error (${status || "Unknown"}): ${errMsg}. ${details ? `\nDetails: ${details}` : ""}\nParams: ${JSON.stringify(normalizeParams(args))}`
            }]
        };
    }
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const CommonSchema = {
    coin: z.string().describe("Coin symbol (e.g. btc, eth). Case-insensitive, but lowercase is preferred."),
    exchange: z
        .string()
        .describe(
            "Exchange identifier (e.g. binance_perp_stable, bybit_perp_stable, okx_perp_stable, dydx_perp_stable, gate_perp_stable). Use hyblock_catalog to see all."
        ),
    timeframe: z
        .enum(["1m", "5m", "15m", "1h", "4h", "1d"])
        .optional()
        .describe("Required candle timeframe. If missing, defaults to 1h."),
    interval: z
        .string()
        .optional()
        .describe("Alias for timeframe (e.g. 1h, 1d)."),
    limit: z
        .coerce.number()
        .optional()
        .describe(
            "Maximum records to return. Allowed values: 5, 10, 20, 50, 100, 500, 1000."
        ),
    startTime: z
        .coerce.number()
        .optional()
        .describe("Optional start Unix timestamp (ms)."),
    endTime: z
        .coerce.number()
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
    return toolHandler(H.ping, {});
});

server.registerTool("hyblock_catalog", z.object({}).describe("Fetch valid coins, exchanges, and symbols support. Use this first to discover available values."), async () => {
    return toolHandler(H.getCatalog, {});
});

server.registerTool("hyblock_data_availability", z.object({
    endpoint: z.string().describe("API endpoint path (e.g. /klines)"),
    coin: z.string(),
    exchange: z.string(),
}).describe("Check historical data range for an endpoint."), async (args: any) => {
    return toolHandler(H.getDataAvailability, args);
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
        return toolHandler(t.fn, args);
    });
}

server.registerTool("hyblock_anchored_cvd", z.object({
    ...CommonSchema,
    anchorTime: z.coerce.number().describe("Unix timestamp (ms) to anchor calculations."),
}).describe("Get CVD anchored to a specific time."), async (args: any) => {
    return toolHandler(H.getAnchoredCVD, args);
});

server.registerTool("hyblock_exchange_premium", z.object({
    ...CommonSchema,
    exchangeB: z.string().describe("Second exchange to compare against."),
}).describe("Get price premium between two exchanges."), async (args: any) => {
    return toolHandler(H.getExchangePremium, args);
});

/**
 * Other Categories
 */

server.registerTool("hyblock_funding_rate", z.object(CommonSchema).describe("Get periodic funding rates."), async (args: any) => {
    return toolHandler(H.getFundingRate, args);
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
        return toolHandler(t.fn, args);
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
        return toolHandler(t.fn, args);
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
    return toolHandler(H.getGlobalBidAskRatio, args);
});

server.registerTool("hyblock_global_combined_book", z.object(GLOBAL_SCHEMA).describe("Global combined book depth."), async (args: any) => {
    return toolHandler(H.getGlobalCombinedBook, args);
});

server.registerTool("hyblock_open_interest", z.object(CommonSchema).describe("Total open interest."), async (args: any) => {
    return toolHandler(H.getOpenInterest, args);
});

server.registerTool("hyblock_open_interest_delta", z.object(CommonSchema).describe("Open interest delta."), async (args: any) => {
    return toolHandler(H.getOpenInterestDelta, args);
});

const VOL_SCHEMA = {
    timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).optional(),
    limit: z.number().optional(),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
    sort: z.enum(["asc", "desc"]).optional(),
};

server.registerTool("hyblock_bvol", z.object(VOL_SCHEMA).describe("Binance Volatility Index (BVOL)."), async (args: any) => {
    return toolHandler(H.getBvol, args);
});

server.registerTool("hyblock_dvol", z.object(VOL_SCHEMA).describe("Deribit Volatility Index (DVOL)."), async (args: any) => {
    return toolHandler(H.getDvol, args);
});

server.registerTool("hyblock_margin_lending_ratio", z.object(CommonSchema).describe("Margin lending ratio."), async (args: any) => {
    return toolHandler(H.getMarginLendingRatio, args);
});

server.registerTool("hyblock_fear_and_greed_index", z.object({
    limit: z.coerce.number().optional(),
    startTime: z.coerce.number().optional(),
    endTime: z.coerce.number().optional(),
    sort: z.enum(["asc", "desc"]).optional(),
}).describe("Market Fear & Greed Index."), async (args: any) => {
    return toolHandler(H.getFearAndGreedIndex, args);
});

server.registerTool("hyblock_user_bot_ratio", z.object(CommonSchema).describe("Human user vs bot ratio."), async (args: any) => {
    return toolHandler(H.getUserBotRatio, args);
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
        return toolHandler(t.fn, args);
    });
}

server.registerTool("hyblock_indicator_profile", z.object({
    indicator: z.string(),
    coin: z.string(),
    exchange: z.string(),
    timeframe: z.string().optional(),
    interval: z.string().optional(),
}).describe("Backtest indicator performance profiles."), async (args: any) => {
    return toolHandler(H.getIndicatorProfile, args);
});

server.registerTool("hyblock_coin_profile", z.object({
    coin: z.string(),
    exchange: z.string(),
}).describe("Coin statistics and profile."), async (args: any) => {
    return toolHandler(H.getCoinProfile, args);
});

/**
 * Register Remaining Tools from Docs
 */

const EXT_TOOLS = [
    { name: "hyblock_previous_week_level", desc: "Previous week open/high/low/equilibrium levels.", fn: H.getPreviousWeekLevel },
    { name: "hyblock_previous_month_level", desc: "Previous month open/high/low/equilibrium levels.", fn: H.getPreviousMonthLevel },
    { name: "hyblock_net_long_short_delta", desc: "Change in net long/short positions.", fn: H.getNetLongShortDelta },
    { name: "hyblock_true_retail_long_short", desc: "Specific retail positioning bias.", fn: H.getTrueRetailLongShort },
    { name: "hyblock_whale_position_dominance", desc: "Whale versus retail position influence.", fn: H.getWhalePositionDominance },
    { name: "hyblock_bid_ask_ratio_diff", desc: "Change in bid-ask ratio over time.", fn: H.getBidAskRatioDiff },
    { name: "hyblock_bid_ask_spread", desc: "Difference between best bid and best ask.", fn: H.getBidAskSpread },
    { name: "hyblock_bids_increase_decrease", desc: "Change in limit bid volume.", fn: H.getBidsIncreaseDecrease },
    { name: "hyblock_asks_increase_decrease", desc: "Change in limit ask volume.", fn: H.getAsksIncreaseDecrease },
    { name: "hyblock_best_bid_ask", desc: "Closest executable bid and ask levels.", fn: H.getBestBidAsk },
    { name: "hyblock_premium_p2p", desc: "Stablecoin P2P premium/discount.", fn: H.getPremiumP2P },
    { name: "hyblock_liquidation_levels_tv", desc: "Liquidation levels formatted for TradingView.", fn: H.getLiquidationLevelsTV },
    { name: "hyblock_top_trader_average_leverage_delta", desc: "Difference in leverage between long and short whales.", fn: H.getTopTraderAverageLeverageDelta },
    { name: "hyblock_top_trader_margin_used", desc: "Total margin used by top long vs short traders.", fn: H.getTopTraderMarginUsed },
    { name: "hyblock_top_trader_margin_used_delta", desc: "Net difference in margin used by whales.", fn: H.getTopTraderMarginUsedDelta },
    { name: "hyblock_liquidation_levels", desc: "Estimated price levels for liquidations.", fn: H.getLiquidationLevels },
    { name: "hyblock_cumulative_liq_level", desc: "Aggregate liquidation statistics.", fn: H.getCumulativeLiqLevel },
    { name: "hyblock_profiles_tool_data", desc: "Enhanced profile analytics (vol delta, OI, liqs).", fn: H.getProfilesToolData },
    { name: "hyblock_net_positions_heatmap_data", desc: "Distribution of positions across price buckets.", fn: H.getNetPositionsHeatmapData },
];

for (const t of EXT_TOOLS) {
    server.registerTool(t.name, z.object(CommonSchema).describe(t.desc), async (args: any) => {
        return toolHandler(t.fn, args);
    });
}

const ANCHOR_TOOLS = [
    { name: "hyblock_anchored_top_trader_accounts", desc: "Anchored whale account bias.", fn: H.getAnchoredTopTraderAccounts },
    { name: "hyblock_anchored_top_trader_positions", desc: "Anchored whale position bias.", fn: H.getAnchoredTopTraderPositions },
    { name: "hyblock_anchored_global_accounts", desc: "Anchored global sentiment bias.", fn: H.getAnchoredGlobalAccounts },
    { name: "hyblock_anchored_clsd", desc: "Anchored net positioning momentum (CLSD).", fn: H.getAnchoredClsd },
    { name: "hyblock_anchored_cls", desc: "Anchored cumulative net positioning (CLS).", fn: H.getAnchoredCls },
    { name: "hyblock_anchored_whale_retail_delta", desc: "Anchored whale vs retail divergence.", fn: H.getAnchoredWhaleRetailDelta },
    { name: "hyblock_anchored_oi_delta", desc: "Anchored change in open interest.", fn: H.getAnchoredOiDelta },
    { name: "hyblock_anchored_liquidation_levels_size", desc: "Anchored size of predicted liq levels.", fn: H.getAnchoredLiquidationLevelsSize },
    { name: "hyblock_anchored_liquidation_levels_count", desc: "Anchored count of predicted liq levels.", fn: H.getAnchoredLiquidationLevelsCount },
];

for (const t of ANCHOR_TOOLS) {
    server.registerTool(t.name, z.object({
        ...CommonSchema,
        anchorTime: z.coerce.number().describe("Unix timestamp (ms) to anchor calculations."),
    }).describe(t.desc), async (args: any) => {
        return toolHandler(t.fn, args);
    });
}

const SPEC_GLOBAL_TOOLS = [
    { name: "hyblock_global_bid_ask", desc: "Aggregated bid-ask volume across all tickers.", fn: H.getGlobalBidAsk },
    { name: "hyblock_global_bid_ask_delta", desc: "Aggregated volume delta across all tickers.", fn: H.getGlobalBidAskDelta },
    { name: "hyblock_global_bid_ask_ratio_increase_decrease", desc: "Change in global bid-ask ratio.", fn: H.getGlobalBidAskRatioIncreaseDecrease },
    { name: "hyblock_global_bids_increase_decrease", desc: "Change in global limit bids.", fn: H.getGlobalBidsIncreaseDecrease },
    { name: "hyblock_global_asks_increase_decrease", desc: "Change in global limit asks.", fn: H.getGlobalAsksIncreaseDecrease },
];

for (const t of SPEC_GLOBAL_TOOLS) {
    server.registerTool(t.name, z.object(GLOBAL_SCHEMA).describe(t.desc), async (args: any) => {
        return toolHandler(t.fn, args);
    });
}

const GLOBAL_MISC_TOOLS = [
    { name: "hyblock_leaderboard_notional_profit", desc: "Top trader notional profit rankings.", fn: H.getLeaderboardNotionalProfit },
    { name: "hyblock_leaderboard_roe_profit", desc: "Top trader ROE profit rankings.", fn: H.getLeaderboardRoeProfit },
    { name: "hyblock_wbtc_mint_burn", desc: "WBTC supply flow activity.", fn: H.getWbtcMintBurn },
];

const MISC_SCHEMA = {
    limit: z.coerce.number().optional(),
    startTime: z.coerce.number().optional(),
    endTime: z.coerce.number().optional(),
    sort: z.enum(["asc", "desc"]).optional(),
};

for (const t of GLOBAL_MISC_TOOLS) {
    server.registerTool(t.name, z.object(MISC_SCHEMA).describe(t.desc), async (args: any) => {
        return toolHandler(t.fn, args);
    });
}

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
    if (PORT) {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
        });

        const app = express();

        // Enable CORS for all origins (Claude.ai, local development, etc.)
        app.use(cors({
            origin: "*",
            methods: ["GET", "POST", "OPTIONS", "HEAD"],
            allowedHeaders: ["Content-Type", "access-control-allow-origin", "mcp-protocol-version", "mcp-session-id"],
            exposedHeaders: ["Location"]
        }));

        app.use(express.json());

        // Root endpoint handles both GET (health/info) and POST/GET (MCP)
        app.all("/", async (req, res, next) => {
            console.log(`[${req.method}] ${req.path} - Accept: ${req.headers.accept}`);
            if (req.method === "GET" && req.headers.accept !== "text/event-stream") {
                return res.send("Hyblock Capital MCP Server is running. Status: OK");
            }
            try {
                await transport.handleRequest(req, res, req.body);
            } catch (err) {
                console.error("Transport error:", err);
                next(err);
            }
        });

        // Explicitly handle standard MCP paths without redirection to avoid transport issues
        app.get("/sse", async (req, res, next) => {
            console.log("[GET] /sse");
            try {
                await transport.handleRequest(req, res, req.body);
            } catch (err) {
                next(err);
            }
        });

        app.post("/messages", async (req, res, next) => {
            console.log("[POST] /messages");
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
            console.log(`Hyblock Capital MCP Server running on port ${port} (HTTP)`);
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
