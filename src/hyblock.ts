import { AxiosInstance } from "axios";

// ─── Shared param types ────────────────────────────────────────────────────────

export interface CommonParams {
    coin: string;
    exchange: string;
    timeframe?: string;
    limit?: number;
    startTime?: number;
    endTime?: number;
    sort?: "asc" | "desc";
}

// ─── System ───────────────────────────────────────────────────────────────────

export async function ping(client: AxiosInstance) {
    const res = await client.get("/ping");
    return res.data;
}

export async function getCatalog(client: AxiosInstance) {
    const res = await client.get("/catalog");
    return res.data;
}

export async function getDataAvailability(
    client: AxiosInstance,
    params: { endpoint: string; coin: string; exchange: string }
) {
    const res = await client.get("/dataAvailability", { params });
    return res.data;
}

// ─── Orderflow ────────────────────────────────────────────────────────────────

export async function getKlines(client: AxiosInstance, params: CommonParams) {
    const res = await client.get("/klines", { params });
    return res.data;
}

export async function getBuyVolume(client: AxiosInstance, params: CommonParams) {
    const res = await client.get("/buyVolume", { params });
    return res.data;
}

export async function getSellVolume(client: AxiosInstance, params: CommonParams) {
    const res = await client.get("/sellVolume", { params });
    return res.data;
}

export async function getVolumeDelta(client: AxiosInstance, params: CommonParams) {
    const res = await client.get("/volumeDelta", { params });
    return res.data;
}

export async function getVolumeRatio(client: AxiosInstance, params: CommonParams) {
    const res = await client.get("/volumeRatio", { params });
    return res.data;
}

export async function getAnchoredCVD(
    client: AxiosInstance,
    params: CommonParams & { anchorTime: number }
) {
    const res = await client.get("/anchoredCVD", { params });
    return res.data;
}

export async function getBotTracker(client: AxiosInstance, params: CommonParams) {
    const res = await client.get("/botTracker", { params });
    return res.data;
}

export async function getSlippage(client: AxiosInstance, params: CommonParams) {
    const res = await client.get("/slippage", { params });
    return res.data;
}

export async function getTransferOfContracts(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/transferOfContracts", { params });
    return res.data;
}

export async function getParticipationRatio(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/participationRatio", { params });
    return res.data;
}

export async function getMarketOrderCount(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/marketOrderCount", { params });
    return res.data;
}

export async function getMarketOrderAverageSize(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/marketOrderAverageSize", { params });
    return res.data;
}

export async function getLimitOrderCount(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/limitOrderCount", { params });
    return res.data;
}

export async function getLimitOrderAverageSize(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/limitOrderAverageSize", { params });
    return res.data;
}

export async function getBuySellTradeCountRatio(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/buySellTradeCountRatio", { params });
    return res.data;
}

export async function getLimitOrderCountRatio(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/limitOrderCountRatio", { params });
    return res.data;
}

export async function getMarketOrderCountRatio(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/marketOrderCountRatio", { params });
    return res.data;
}

export async function getExchangePremium(
    client: AxiosInstance,
    params: CommonParams & { exchangeB: string }
) {
    const res = await client.get("/exchangePremium", { params });
    return res.data;
}

export async function getPdLevels(client: AxiosInstance, params: CommonParams) {
    const res = await client.get("/pdLevels", { params });
    return res.data;
}

// ─── Funding Rate ─────────────────────────────────────────────────────────────

export async function getFundingRate(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/fundingRate", { params });
    return res.data;
}

// ─── Longs & Shorts ───────────────────────────────────────────────────────────

export async function getTopTraderAccounts(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/topTraderAccounts", { params });
    return res.data;
}

export async function getTopTraderPositions(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/topTraderPositions", { params });
    return res.data;
}

export async function getGlobalAccounts(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/globalAccounts", { params });
    return res.data;
}

export async function getNetLongShort(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/netLongShort", { params });
    return res.data;
}

export async function getWhaleRetailDelta(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/whaleRetailDelta", { params });
    return res.data;
}

export async function getTraderSentimentGap(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/traderSentimentGap", { params });
    return res.data;
}

// ─── Orderbook ────────────────────────────────────────────────────────────────

export async function getBidAsk(client: AxiosInstance, params: CommonParams) {
    const res = await client.get("/bidAsk", { params });
    return res.data;
}

export async function getBidAskRatio(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/bidAskRatio", { params });
    return res.data;
}

export async function getBidAskDelta(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/bidAskDelta", { params });
    return res.data;
}

export async function getCombinedBook(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/combinedBook", { params });
    return res.data;
}

export async function getMarketImbalanceIndex(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/marketImbalanceIndex", { params });
    return res.data;
}

// ─── Global Metrics ───────────────────────────────────────────────────────────

export async function getGlobalBidAskRatio(
    client: AxiosInstance,
    params: { coin: string; timeframe?: string; limit?: number; startTime?: number; endTime?: number; sort?: "asc" | "desc" }
) {
    const res = await client.get("/globalBidAskRatio", { params });
    return res.data;
}

export async function getGlobalCombinedBook(
    client: AxiosInstance,
    params: { coin: string; timeframe?: string; limit?: number; startTime?: number; endTime?: number; sort?: "asc" | "desc" }
) {
    const res = await client.get("/globalCombinedBook", { params });
    return res.data;
}

// ─── Open Interest ────────────────────────────────────────────────────────────

export async function getOpenInterest(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/openInterest", { params });
    return res.data;
}

export async function getOpenInterestDelta(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/openInterestDelta", { params });
    return res.data;
}

// ─── Options ─────────────────────────────────────────────────────────────────

export async function getBvol(
    client: AxiosInstance,
    params: { timeframe?: string; limit?: number; startTime?: number; endTime?: number; sort?: "asc" | "desc" }
) {
    const res = await client.get("/bvol", { params });
    return res.data;
}

export async function getDvol(
    client: AxiosInstance,
    params: { timeframe?: string; limit?: number; startTime?: number; endTime?: number; sort?: "asc" | "desc" }
) {
    const res = await client.get("/dvol", { params });
    return res.data;
}

// ─── Sentiment ────────────────────────────────────────────────────────────────

export async function getMarginLendingRatio(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/marginLendingRatio", { params });
    return res.data;
}

export async function getFearAndGreedIndex(
    client: AxiosInstance,
    params: { limit?: number; startTime?: number; endTime?: number; sort?: "asc" | "desc" }
) {
    const res = await client.get("/fearAndGreedIndex", { params });
    return res.data;
}

export async function getUserBotRatio(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/userBotRatio", { params });
    return res.data;
}

// ─── Liquidity ────────────────────────────────────────────────────────────────

export async function getLiquidation(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/liquidation", { params });
    return res.data;
}

export async function getLiqLevelsCount(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/liqLevelsCount", { params });
    return res.data;
}

export async function getLiqLevelsSize(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/liqLevelsSize", { params });
    return res.data;
}

export async function getLiquidationHeatmap(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/liquidationHeatmap", { params });
    return res.data;
}

export async function getAvgLeverageUsed(
    client: AxiosInstance,
    params: CommonParams
) {
    const res = await client.get("/avgLeverageUsed", { params });
    return res.data;
}

// ─── Profile Tool ─────────────────────────────────────────────────────────────

export async function getIndicatorProfile(
    client: AxiosInstance,
    params: { indicator: string; coin: string; exchange: string; timeframe?: string }
) {
    const res = await client.get("/indicatorProfile", { params });
    return res.data;
}

export async function getCoinProfile(
    client: AxiosInstance,
    params: { coin: string; exchange: string }
) {
    const res = await client.get("/coinProfile", { params });
    return res.data;
}
