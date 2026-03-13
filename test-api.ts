import { createApiClient } from "./src/auth.js";
import * as H from "./src/hyblock.js";

const CLIENT_ID = process.env.HYBLOCK_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.HYBLOCK_CLIENT_SECRET ?? "";
const API_KEY = process.env.HYBLOCK_API_KEY ?? "";

console.log("Testing with:");
console.log("CLIENT_ID:", CLIENT_ID);
console.log("CLIENT_SECRET:", CLIENT_SECRET ? "***" : "MISSING");
console.log("API_KEY:", API_KEY ? "***" : "MISSING");

async function test() {
    try {
        const client = await createApiClient(CLIENT_ID, CLIENT_SECRET, API_KEY);

        console.log("\n1. Testing Ping...");
        const pingResult = await H.ping(client);
        console.log("Ping Result:", JSON.stringify(pingResult, null, 2));

        console.log("\n2. Testing Catalog...");
        const catalogResult = await H.getCatalog(client);
        console.log("Catalog Exchanges:", Object.keys(catalogResult.data));

        console.log("\n3. Testing Klines (btc/binance_perp_stable)...");
        const klinesResult = await H.getKlines(client, { coin: "btc", exchange: "binance_perp_stable", timeframe: "1h", limit: 5 });
        console.log("Klines Result (first 2):", JSON.stringify(klinesResult.data?.slice(0, 2) || klinesResult.slice(0, 2), null, 2));

        console.log("\n4. Testing Liquidations...");
        const liqResult = await H.getLiquidation(client, { coin: "btc", exchange: "binance_perp_stable", timeframe: "1h", limit: 5 });
        console.log("Liquidation Result (first 2):", JSON.stringify(liqResult.data?.slice(0, 2) || liqResult.slice(0, 2), null, 2));

        console.log("\n5. Testing Open Interest...");
        const oiResult = await H.getOpenInterest(client, { coin: "btc", exchange: "binance_perp_stable", timeframe: "1h", limit: 5 });
        console.log("OI Result (first 2):", JSON.stringify(oiResult.data?.slice(0, 2) || oiResult.slice(0, 2), null, 2));

        console.log("\n6. Testing Funding Rate...");
        const frResult = await H.getFundingRate(client, { coin: "btc", exchange: "binance_perp_stable", timeframe: "1h", limit: 5 });
        console.log("Funding Rate Result (first 2):", JSON.stringify(frResult.data?.slice(0, 2) || frResult.slice(0, 2), null, 2));

        console.log("\nAll basic tests passed!");
    } catch (error: any) {
        console.error("\nTest Failed!");
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Data:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("Error:", error.message);
        }
        process.exit(1);
    }
}

test();
