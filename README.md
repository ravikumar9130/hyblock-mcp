# Hyblock Capital MCP Server

An [MCP](https://modelcontextprotocol.io/) server exposing the full [Hyblock Capital API](https://hyblockcapital.com/api-explorer) as tools for AI assistants (Claude, Gemini, etc.).

**Transport**: HTTP (MCP over stdio → upstream calls via HTTPS to Hyblock API)

---

## Features

- ✅ **53 tools** covering all Hyblock API endpoints
- ✅ **OAuth2 token caching** — automatically refreshes tokens before expiry
- ✅ **Typed parameters** with descriptions for every tool
- ✅ **Clear error messages** including HTTP status codes from the API

### Tool Categories

| Category | Tools |
|---|---|
| System | `ping`, `catalog`, `data_availability` |
| Orderflow | `klines`, `buy_volume`, `sell_volume`, `volume_delta`, `volume_ratio`, `anchored_cvd`, `bot_tracker`, `slippage`, `transfer_of_contracts`, `participation_ratio`, `market_order_count`, `market_order_average_size`, `limit_order_count`, `limit_order_average_size`, `buy_sell_trade_count_ratio`, `limit_order_count_ratio`, `market_order_count_ratio`, `exchange_premium`, `pd_levels` |
| Funding Rate | `funding_rate` |
| Longs & Shorts | `top_trader_accounts`, `top_trader_positions`, `global_accounts`, `net_long_short`, `whale_retail_delta`, `trader_sentiment_gap` |
| Orderbook | `bid_ask`, `bid_ask_ratio`, `bid_ask_delta`, `combined_book`, `market_imbalance_index` |
| Global Metrics | `global_bid_ask_ratio`, `global_combined_book` |
| Open Interest | `open_interest`, `open_interest_delta` |
| Options | `bvol`, `dvol` |
| Sentiment | `margin_lending_ratio`, `fear_and_greed_index`, `user_bot_ratio` |
| Liquidity | `liquidation`, `liq_levels_count`, `liq_levels_size`, `liquidation_heatmap`, `avg_leverage_used` |
| Profile Tool | `indicator_profile`, `coin_profile` |

---

## Prerequisites

1. A **Hyblock Capital** account with API access
2. Your `client_id`, `client_secret`, and `x-api-key` from the [API Explorer](https://hyblockcapital.com/api-explorer)
3. **Node.js ≥ 18**

---

## Setup

```bash
git clone <repo-url>
cd mcp
npm install
npm run build
```

---

## Configuration

Set these environment variables before running (locally or in Railway):

```bash
export HYBLOCK_CLIENT_ID="your_client_id"
export HYBLOCK_CLIENT_SECRET="your_client_secret"
export HYBLOCK_API_KEY="your_api_key"
```

Add the server to your MCP client configuration (e.g., `claude_desktop_config.json`).

### Option 1: Local Deployment (Standard)
Use this if you are running the server on your own machine.

```json
{
  "mcpServers": {
    "hyblock-local": {
      "command": "node",
      "args": ["mcp/dist/index.js"],
      "env": {
        "HYBLOCK_CLIENT_ID": "your_client_id",
        "HYBLOCK_CLIENT_SECRET": "your_client_secret",
        "HYBLOCK_API_KEY": "your_api_key"
      }
    }
  }
}
```

### Option 2: Deployed Deployment (Railway / Cloud)
Use this if you have deployed the server to Railway. This uses the **SSE (Server-Sent Events) over HTTP** transport.

#### Setup in Railway
1. Connect your GitHub repository to Railway.
2. Add the following **Environment Variables** (all are **required**; the server will refuse to start if any are missing or empty):
   - `HYBLOCK_CLIENT_ID`
   - `HYBLOCK_CLIENT_SECRET`
   - `HYBLOCK_API_KEY`
3. Railway will use the `Dockerfile` to build and deploy. It will automatically assign a `PORT`.

#### How to "Enter" in MCP Clients
Once live, your server will have a base URL (e.g., `https://hyblock-mcp-production.up.railway.app`). 

**For most MCP clients (like Claude Desktop)**, you must point them to the `/sse` endpoint, not the bare root:

```json
{
  "mcpServers": {
    "hyblock-remote": {
      "url": "https://your-railway-app.up.railway.app/sse"
    }
  }
}
```

*Note: If your client doesn't support the `url` field yet, you can use a small node bridge or the local version.*

If you see `❌ API Error (401)` or `❌ API Error (403)` from any Hyblock tools, first verify that:

- `HYBLOCK_CLIENT_ID`, `HYBLOCK_CLIENT_SECRET`, and `HYBLOCK_API_KEY` are correctly set in the server environment (Railway or local).
- Your MCP client configuration is using the `/sse` endpoint as shown above.

---

## Authentication Flow

The server implements the **OAuth2 Client Credentials** flow automatically:

1. On first API call, it exchanges `client_id:client_secret` (Base64 encoded) for a Bearer token via `POST /oauth2/token`
2. The token is **cached in memory** until 60 seconds before expiry
3. Subsequent calls reuse the cached token — no manual refresh needed

---

## Tools Categorization

The server exposes 53 tools across these areas:
- **System**: Health check, Catalog (use this to find valid coins/exchanges).
- **Orderflow**: 19 tools (CVD, Bot Tracker, Slippage, etc).
- **Funding**: Perpetual funding rates.
- **Liquidity**: Liquidation heatmaps and levels.
- **Sentiment**: Whale/Retail delta and market sentiment indexes.
- **And more...**

## Common Parameters

Most tools accept these optional parameters:

| Parameter | Type | Description |
|---|---|---|
| `timeframe` | string | `1m`, `5m`, `15m`, `1h`, `4h`, `1d` |
| `limit` | number | Records to return (max 1000) |
| `startTime` | number | Start of range (Unix ms) |
| `endTime` | number | End of range (Unix ms) |
| `sort` | string | `asc` or `desc` |

> **Tip**: Call `hyblock_catalog` first to discover valid `coin` and `exchange` values.
