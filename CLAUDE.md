# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

b.trade is a real-time Solana memecoin tracker focused on Pump.fun tokens. It displays new pairs, tokens approaching graduation (bonding curve completion), and graduated tokens on Raydium.

## Commands

```bash
npm install    # Install dependencies
npm start      # Start backend server on http://localhost:3000
```

## Architecture

```
b.trade/
├── index.html    # Frontend (vanilla JS, WebSocket client)
├── server.js     # Node.js backend (Express + WebSocket)
└── package.json  # Dependencies: express, ws
```

### Data Flow

1. **Backend** fetches from multiple sources every 10 seconds:
   - DexScreener (token-boosts, search API)
   - GeckoTerminal (new_pools, trending_pools)
   - Pump.fun API (often blocked by Cloudflare)

2. **WebSocket** broadcasts updates to connected clients

3. **Frontend** displays tokens in 3 columns:
   - New Pairs (< 10 min, on pump.fun)
   - Final Stretch (> 50% bonding curve)
   - Graduated (on Raydium, MCap >= $69K)

### API Endpoints

- `GET /api/pump` - Returns all cached tokens as JSON
- `WS /ws` - WebSocket for real-time updates

## Design Constraints

- No frameworks (vanilla HTML/CSS/JS)
- Compatible with older browsers (no ES6+ in frontend)
- Dark theme optimized for trading
- Responsive layout for mobile

## Key Constants

- Graduation threshold: $69,000 MCap
- Cache duration: 5 seconds
- WebSocket update interval: 10 seconds
