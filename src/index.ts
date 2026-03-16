import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
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

interface SessionData {
    server: McpServer;
    transport: StreamableHTTPServerTransport;
}

const sessions: Record<string, SessionData> = {};

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

const CommonSchema = z.object({
    coin: z.string().describe("Coin symbol (e.g. btc, eth)."),
    exchange: z.string().describe("Exchange identifier (e.g. binance_perp_stable, bybit_perp_stable)."),
    timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).describe("Required candle timeframe."),
    limit: z.coerce.number().optional(),
    startTime: z.coerce.number().optional(),
    endTime: z.coerce.number().optional(),
    sort: z.enum(["asc", "desc"]).optional(),
}).describe("Common parameters for hyblock endpoints");

const CoinTimeframeSchema = z.object({
    coin: z.string().describe("Coin symbol (e.g. btc, eth)."),
    timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).describe("Required candle timeframe."),
    limit: z.coerce.number().optional(),
    startTime: z.coerce.number().optional(),
    endTime: z.coerce.number().optional(),
    sort: z.enum(["asc", "desc"]).optional(),
}).describe("Coin and timeframe parameters");

const AnchorSchema = z.object({
    coin: z.string().describe("Coin symbol (e.g. btc, eth)."),
    exchange: z.string().describe("Exchange identifier (e.g. binance_perp_stable, bybit_perp_stable)."),
    timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).describe("Required candle timeframe."),
    anchor: z.enum(["1h", "4h", "1d"]).describe("Aggregation interval for anchored calculations."),
    limit: z.coerce.number().optional(),
    startTime: z.coerce.number().optional(),
    endTime: z.coerce.number().optional(),
    sort: z.enum(["asc", "desc"]).optional(),
}).describe("Anchor parameters");

const LIQ_LVL_SCHEMA = z.object({
    coin: z.string().describe("Coin symbol (e.g. btc, eth)."),
    exchange: z.string().describe("Exchange identifier (e.g. binance_perp_stable, bybit_perp_stable)."),
    timestamp: z.coerce.number().optional(),
    leverage: z.enum(["all", "high", "medium", "low"]).optional(),
    position: z.enum(["long", "short"]).optional(),
}).describe("Liquidation levels parameters");

const HEATMAP_SCHEMA = z.object({
    coin: z.string().describe("Coin symbol (e.g. btc, eth)."),
    exchange: z.string().describe("Exchange identifier (e.g. binance_perp_stable, bybit_perp_stable)."),
    lookback: z.coerce.number().optional(),
    leverage: z.enum(["l1", "l2", "l3", "l4", "l5", "all"]).optional(),
}).describe("Heatmap parameters");

const tools = [
    { name: "hyblock_ping", schema: z.object({}), fn: H.ping, desc: "Check Hyblock API health." },
    { name: "hyblock_catalog", schema: z.object({}), fn: H.getCatalog, desc: "Discovery for available coins/exchanges." },
    { name: "hyblock_data_availability", schema: z.object({
        endpointName: z.string().describe("e.g. klines"),
        coin: z.string(),
        exchange: z.string().optional(),
    }).describe("Check historical range."), fn: H.getDataAvailability, desc: "Check historical range." },
    { name: "hyblock_klines", schema: CommonSchema, fn: H.getKlines, endpoint: "klines", desc: "OHLCV klines data." },
    { name: "hyblock_buy_volume", schema: CommonSchema, fn: H.getBuyVolume, endpoint: "buyVolume", desc: "Buy volume data." },
    { name: "hyblock_sell_volume", schema: CommonSchema, fn: H.getSellVolume, endpoint: "sellVolume", desc: "Sell volume data." },
    { name: "hyblock_volume_delta", schema: CommonSchema, fn: H.getVolumeDelta, endpoint: "volumeDelta", desc: "Volume delta." },
    { name: "hyblock_volume_ratio", schema: CommonSchema, fn: H.getVolumeRatio, endpoint: "volumeRatio", desc: "Volume ratio." },
    { name: "hyblock_bot_tracker", schema: CommonSchema, fn: H.getBotTracker, endpoint: "botTracker", desc: "Bot tracker data." },
    { name: "hyblock_slippage", schema: CommonSchema, fn: H.getSlippage, endpoint: "slippage", desc: "Slippage data." },
    { name: "hyblock_transfer_of_contracts", schema: CommonSchema, fn: H.getTransferOfContracts, endpoint: "transferOfContracts", desc: "Transfer of contracts." },
    { name: "hyblock_participation_ratio", schema: CommonSchema, fn: H.getParticipationRatio, endpoint: "participationRatio", desc: "Participation ratio." },
    { name: "hyblock_market_order_count", schema: CommonSchema, fn: H.getMarketOrderCount, endpoint: "marketOrderCount", desc: "Market order count." },
    { name: "hyblock_market_order_average_size", schema: CommonSchema, fn: H.getMarketOrderAverageSize, endpoint: "marketOrderAverageSize", desc: "Market order average size." },
    { name: "hyblock_limit_order_count", schema: CommonSchema, fn: H.getLimitOrderCount, endpoint: "limitOrderCount", desc: "Limit order count." },
    { name: "hyblock_limit_order_average_size", schema: CommonSchema, fn: H.getLimitOrderAverageSize, endpoint: "limitOrderAverageSize", desc: "Limit order average size." },
    { name: "hyblock_buy_sell_trade_count_ratio", schema: CommonSchema, fn: H.getBuySellTradeCountRatio, endpoint: "buySellTradeCountRatio", desc: "Buy/sell trade count ratio." },
    { name: "hyblock_limit_order_count_ratio", schema: CommonSchema, fn: H.getLimitOrderCountRatio, endpoint: "limitOrderCountRatio", desc: "Limit order count ratio." },
    { name: "hyblock_market_order_count_ratio", schema: CommonSchema, fn: H.getMarketOrderCountRatio, endpoint: "marketOrderCountRatio", desc: "Market order count ratio." },
    { name: "hyblock_pd_levels", schema: CommonSchema, fn: H.getPdLevels, endpoint: "pdLevels", desc: "Price detection levels." },
    { name: "hyblock_anchored_cvd", schema: AnchorSchema, fn: H.getAnchoredCVD, endpoint: "anchoredCVD", desc: "Anchored CVD." },
    { name: "hyblock_exchange_premium", schema: z.object({
        coin: z.string().describe("Coin symbol (e.g. btc, eth)."),
        exchange1: z.string().describe("First exchange."),
        exchange2: z.string().describe("Second exchange."),
        timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).describe("Timeframe."),
        mode: z.enum(["standard", "percentage"]).optional().describe("Mode."),
    }).describe("Exchange premium."), fn: H.getExchangePremium, endpoint: "exchangePremium", desc: "Exchange premium between two exchanges." },
    { name: "hyblock_funding_rate", schema: CoinTimeframeSchema, fn: H.getFundingRate, endpoint: "fundingRate", desc: "Funding rate." },
    { name: "hyblock_top_trader_accounts", schema: CommonSchema, fn: H.getTopTraderAccounts, endpoint: "topTraderAccounts", desc: "Top trader accounts." },
    { name: "hyblock_top_trader_positions", schema: CommonSchema, fn: H.getTopTraderPositions, endpoint: "topTraderPositions", desc: "Top trader positions." },
    { name: "hyblock_global_accounts", schema: CommonSchema, fn: H.getGlobalAccounts, endpoint: "globalAccounts", desc: "Global accounts." },
    { name: "hyblock_net_long_short", schema: CommonSchema, fn: H.getNetLongShort, endpoint: "netLongShort", desc: "Net long/short positions." },
    { name: "hyblock_whale_retail_delta", schema: CommonSchema, fn: H.getWhaleRetailDelta, endpoint: "whaleRetailDelta", desc: "Whale vs retail delta." },
    { name: "hyblock_trader_sentiment_gap", schema: CommonSchema, fn: H.getTraderSentimentGap, endpoint: "traderSentimentGap", desc: "Trader sentiment gap." },
    { name: "hyblock_combined_book", schema: CoinTimeframeSchema, fn: H.getCombinedBook, endpoint: "combinedBook", desc: "Combined order book." },
    { name: "hyblock_bid_ask", schema: CommonSchema, fn: H.getBidAsk, endpoint: "bidAsk", desc: "Bid/ask prices." },
    { name: "hyblock_bid_ask_ratio", schema: CommonSchema, fn: H.getBidAskRatio, endpoint: "bidAskRatio", desc: "Bid/ask ratio." },
    { name: "hyblock_bid_ask_delta", schema: CommonSchema, fn: H.getBidAskDelta, endpoint: "bidAskDelta", desc: "Bid/ask delta." },
    { name: "hyblock_market_imbalance_index", schema: CommonSchema, fn: H.getMarketImbalanceIndex, endpoint: "marketImbalanceIndex", desc: "Market imbalance index." },
    { name: "hyblock_global_bid_ask_ratio", schema: CoinTimeframeSchema, fn: H.getGlobalBidAskRatio, endpoint: "globalBidAskRatio", desc: "Global bid/ask ratio." },
    { name: "hyblock_global_combined_book", schema: CoinTimeframeSchema, fn: H.getGlobalCombinedBook, endpoint: "globalCombinedBook", desc: "Global combined book." },
    { name: "hyblock_open_interest", schema: CoinTimeframeSchema, fn: H.getOpenInterest, endpoint: "openInterest", desc: "Open interest." },
    { name: "hyblock_open_interest_delta", schema: CoinTimeframeSchema, fn: H.getOpenInterestDelta, endpoint: "openInterestDelta", desc: "Open interest delta." },
    { name: "hyblock_bvol", schema: CommonSchema, fn: H.getBvol, endpoint: "bvol", desc: "Bitcoin volume." },
    { name: "hyblock_dvol", schema: CommonSchema, fn: H.getDvol, endpoint: "dvol", desc: "Dominance volume." },
    { name: "hyblock_margin_lending_ratio", schema: CommonSchema, fn: H.getMarginLendingRatio, endpoint: "marginLendingRatio", desc: "Margin lending ratio." },
    { name: "hyblock_user_bot_ratio", schema: CommonSchema, fn: H.getUserBotRatio, endpoint: "userBotRatio", desc: "User bot ratio." },
    { name: "hyblock_liquidation", schema: CommonSchema, fn: H.getLiquidation, endpoint: "liquidation", desc: "Liquidation data." },
    { name: "hyblock_liq_levels_count", schema: CommonSchema, fn: H.getLiqLevelsCount, endpoint: "liqLevelsCount", desc: "Liquidation levels count." },
    { name: "hyblock_liq_levels_size", schema: CommonSchema, fn: H.getLiqLevelsSize, endpoint: "liqLevelsSize", desc: "Liquidation levels size." },
    { name: "hyblock_liquidation_heatmap", schema: HEATMAP_SCHEMA, fn: H.getLiquidationHeatmap, endpoint: "liquidationHeatmap", desc: "Liquidation heatmap." },
    { name: "hyblock_net_long_short_delta", schema: CommonSchema, fn: H.getNetLongShortDelta, endpoint: "netLongShortDelta", desc: "Net long/short delta." },
    { name: "hyblock_true_retail_long_short", schema: CommonSchema, fn: H.getTrueRetailLongShort, endpoint: "trueRetailLongShort", desc: "True retail long/short." },
    { name: "hyblock_bid_ask_ratio_diff", schema: CommonSchema, fn: H.getBidAskRatioDiff, endpoint: "bidAskRatioDiff", desc: "Bid/ask ratio difference." },
    { name: "hyblock_bids_increase_decrease", schema: CommonSchema, fn: H.getBidsIncreaseDecrease, endpoint: "bidsIncreaseDecrease", desc: "Bids increase/decrease." },
    { name: "hyblock_asks_increase_decrease", schema: CommonSchema, fn: H.getAsksIncreaseDecrease, endpoint: "asksIncreaseDecrease", desc: "Asks increase/decrease." },
    { name: "hyblock_best_bid_ask", schema: CommonSchema, fn: H.getBestBidAsk, endpoint: "bestBidAsk", desc: "Best bid/ask." },
    { name: "hyblock_top_trader_margin_used", schema: CommonSchema, fn: H.getTopTraderMarginUsed, endpoint: "topTraderMarginUsed", desc: "Top trader margin used." },
    { name: "hyblock_top_trader_margin_used_delta", schema: CommonSchema, fn: H.getTopTraderMarginUsedDelta, endpoint: "topTraderMarginUsedDelta", desc: "Top trader margin used delta." },
    { name: "hyblock_liquidation_levels_tv", schema: LIQ_LVL_SCHEMA, fn: H.getLiquidationLevelsTV, endpoint: "liquidationLevelsTV", desc: "Liquidation levels TV." },
    { name: "hyblock_liquidation_levels", schema: LIQ_LVL_SCHEMA, fn: H.getLiquidationLevels, endpoint: "liquidationLevels", desc: "Liquidation levels." },
    { name: "hyblock_cumulative_liq_level", schema: LIQ_LVL_SCHEMA, fn: H.getCumulativeLiqLevel, endpoint: "cumulativeLiqLevel", desc: "Cumulative liquidation level." },
    { name: "hyblock_anchored_top_trader_accounts", schema: AnchorSchema, fn: H.getAnchoredTopTraderAccounts, endpoint: "anchoredTopTraderAccounts", desc: "Anchored top trader accounts." },
    { name: "hyblock_anchored_top_trader_positions", schema: AnchorSchema, fn: H.getAnchoredTopTraderPositions, endpoint: "anchoredTopTraderPositions", desc: "Anchored top trader positions." },
    { name: "hyblock_anchored_global_accounts", schema: AnchorSchema, fn: H.getAnchoredGlobalAccounts, endpoint: "anchoredGlobalAccounts", desc: "Anchored global accounts." },
    { name: "hyblock_anchored_whale_retail_delta", schema: AnchorSchema, fn: H.getAnchoredWhaleRetailDelta, endpoint: "anchoredWhaleRetailDelta", desc: "Anchored whale/retail delta." },
    { name: "hyblock_global_bid_ask", schema: CoinTimeframeSchema, fn: H.getGlobalBidAsk, endpoint: "globalBidAsk", desc: "Global bid/ask." },
    { name: "hyblock_global_bid_ask_delta", schema: CoinTimeframeSchema, fn: H.getGlobalBidAskDelta, endpoint: "globalBidAskDelta", desc: "Global bid/ask delta." },
    { name: "hyblock_global_bid_ask_ratio_increase_decrease", schema: CoinTimeframeSchema, fn: H.getGlobalBidAskRatioIncreaseDecrease, endpoint: "globalBidAskRatioIncreaseDecrease", desc: "Global bid/ask ratio increase/decrease." },
    { name: "hyblock_global_bids_increase_decrease", schema: CoinTimeframeSchema, fn: H.getGlobalBidsIncreaseDecrease, endpoint: "globalBidsIncreaseDecrease", desc: "Global bids increase/decrease." },
    { name: "hyblock_global_asks_increase_decrease", schema: CoinTimeframeSchema, fn: H.getGlobalAsksIncreaseDecrease, endpoint: "globalAsksIncreaseDecrease", desc: "Global asks increase/decrease." },
    { name: "hyblock_leaderboard_notional_profit", schema: z.object({
        timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).describe("Timeframe."),
        limit: z.coerce.number().optional(),
    }).describe("Leaderboard notional profit."), fn: H.getLeaderboardNotionalProfit, endpoint: "leaderboardNotionalProfit", desc: "Leaderboard notional profit." },
    { name: "hyblock_wbtc_mint_burn", schema: z.object({
        timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).describe("Timeframe."),
        limit: z.coerce.number().optional(),
    }).describe("WBTC mint/burn."), fn: H.getWbtcMintBurn, endpoint: "wbtcMintBurn", desc: "WBTC mint/burn data." },
];

function createMcpServer(): McpServer {
    const server = new McpServer({
        name: "hyblock-mcp-server",
        version: "1.0.0"
    });

    for (const tool of tools) {
        server.tool(
            tool.name,
            tool.desc,
            tool.schema.shape as any,
            async (args: any) => {
                const result = await toolHandler(tool.fn, args, tool.endpoint);
                return result;
            }
        );
    }

    return server;
}

const app = express();

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "mcp-session-id"],
    exposedHeaders: ["mcp-session-id"],
}));

app.use(express.json());

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

app.post("/mcp", async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    const existingSession = sessionId && sessions[sessionId];

    if (existingSession) {
        try {
            await existingSession.transport.handleRequest(req, res, req.body);
        } catch (err) {
            console.error("Transport error:", err);
            if (!res.headersSent) {
                res.status(500).json({ jsonrpc: "2.0", error: { code: -32000, message: "Internal server error" }, id: null });
            }
        }
        return;
    }

    const newSessionId = randomUUID();
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: (session) => {
            sessions[newSessionId] = { server, transport };
            res.setHeader("mcp-session-id", newSessionId);
        }
    });

    try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        
        if (!res.headersSent) {
            res.setHeader("mcp-session-id", newSessionId);
        }
    } catch (err) {
        console.error("Transport error:", err);
        if (!res.headersSent) {
            res.status(500).json({ jsonrpc: "2.0", error: { code: -32000, message: "Internal server error" }, id: null });
        }
    }
});

app.get("/mcp", async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    const session = sessionId && sessions[sessionId];

    if (!session) {
        res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "No valid session ID provided" }, id: null });
        return;
    }

    try {
        await session.transport.handleRequest(req, res);
    } catch (err) {
        console.error("Transport error:", err);
        if (!res.headersSent) {
            res.status(500).json({ jsonrpc: "2.0", error: { code: -32000, message: "Internal server error" }, id: null });
        }
    }
});

app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Hyblock MCP Server v1.0.0 listening on port ${PORT}`);
});