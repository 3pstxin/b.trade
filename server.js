const express = require('express');
const WebSocket = require('ws');
const https = require('https');
const http = require('http');

const app = express();
const PORT = 3000;

// Cache
let pumpCoins = [];
let lastFetch = 0;
const CACHE_DURATION = 5000;

// Serve static files
app.use(express.static(__dirname));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

// Browser-like headers to avoid Cloudflare blocks
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Origin': 'https://pump.fun',
  'Referer': 'https://pump.fun/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site'
};

function fetchJSON(url, retries = 2) {
  return new Promise((resolve, reject) => {
    const doRequest = (attempt) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: HEADERS
      };

      https.get(options, (res) => {
        let data = '';

        // Handle gzip
        if (res.headers['content-encoding'] === 'gzip') {
          const zlib = require('zlib');
          const gunzip = zlib.createGunzip();
          res.pipe(gunzip);
          gunzip.on('data', chunk => data += chunk);
          gunzip.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(e); }
          });
        } else {
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) {
              if (attempt < retries) {
                setTimeout(() => doRequest(attempt + 1), 1000);
              } else {
                reject(new Error(`Invalid JSON: ${data.substring(0, 100)}`));
              }
            }
          });
        }
      }).on('error', (e) => {
        if (attempt < retries) {
          setTimeout(() => doRequest(attempt + 1), 1000);
        } else {
          reject(e);
        }
      });
    };
    doRequest(0);
  });
}

// Fetch from DexScreener (more reliable)
async function fetchDexScreener() {
  const coins = [];
  const now = Date.now();

  try {
    // Get boosted/trending tokens
    const boosts = await fetchJSON('https://api.dexscreener.com/token-boosts/top/v1');
    if (Array.isArray(boosts)) {
      const solanaTokens = boosts
        .filter(t => t.chainId === 'solana')
        .slice(0, 30)
        .map(t => t.tokenAddress);

      if (solanaTokens.length > 0) {
        const tokenData = await fetchJSON(`https://api.dexscreener.com/latest/dex/tokens/${solanaTokens.join(',')}`);
        if (tokenData && tokenData.pairs) {
          tokenData.pairs.forEach(p => {
            if (p.chainId === 'solana' && (p.dexId === 'pumpfun' || p.dexId === 'raydium')) {
              coins.push(processDexPair(p, now));
            }
          });
        }
      }
    }
  } catch (e) {
    console.error('DexScreener boosts error:', e.message);
  }

  // Search for recent pump.fun tokens
  const searches = ['pump', 'new', 'meme'];
  for (const q of searches) {
    try {
      const data = await fetchJSON(`https://api.dexscreener.com/latest/dex/search?q=${q}`);
      if (data && data.pairs) {
        data.pairs.forEach(p => {
          if (p.chainId === 'solana' && (p.dexId === 'pumpfun' || p.dexId === 'raydium')) {
            const existing = coins.find(c => c.address === p.baseToken?.address);
            if (!existing) {
              coins.push(processDexPair(p, now));
            }
          }
        });
      }
    } catch (e) {
      console.error(`DexScreener search ${q} error:`, e.message);
    }
  }

  return coins;
}

function processDexPair(p, now) {
  const age = p.pairCreatedAt ? now - p.pairCreatedAt : null;
  const mcap = parseFloat(p.fdv) || 0;
  const isPumpFun = p.dexId === 'pumpfun';
  const graduated = p.dexId === 'raydium' || mcap >= 69000;

  return {
    symbol: p.baseToken?.symbol || '???',
    name: p.baseToken?.name || '',
    address: p.baseToken?.address || '',
    price: parseFloat(p.priceUsd) || 0,
    mcap: mcap,
    progress: Math.min((mcap / 69000) * 100, 100),
    graduated: graduated,
    isKing: false,
    replies: 0,
    image: p.info?.imageUrl || null,
    created: p.pairCreatedAt || now,
    age: age,
    url: `https://dexscreener.com/solana/${p.pairAddress}`,
    volume24h: p.volume?.h24 ? parseFloat(p.volume.h24) : 0,
    liquidity: p.liquidity?.usd ? parseFloat(p.liquidity.usd) : 0,
    change24h: p.priceChange?.h24 ? parseFloat(p.priceChange.h24) : 0,
    dex: p.dexId
  };
}

// Fetch from GeckoTerminal (backup)
async function fetchGeckoTerminal() {
  const coins = [];
  const now = Date.now();

  const endpoints = [
    'https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1',
    'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools'
  ];

  for (const url of endpoints) {
    try {
      const data = await fetchJSON(url);
      if (data && data.data) {
        data.data.forEach(pool => {
          const attr = pool.attributes || {};
          const rel = pool.relationships || {};
          const dexData = rel.dex?.data;

          let dexId = '';
          if (dexData?.id) {
            if (dexData.id.includes('pump')) dexId = 'pumpfun';
            else if (dexData.id.includes('raydium')) dexId = 'raydium';
          }
          if (!dexId) return;

          const age = attr.pool_created_at ? now - new Date(attr.pool_created_at).getTime() : null;
          const name = attr.name || '';
          const symbol = name.split('/')[0]?.trim() || name.split(' ')[0] || '???';
          const addr = pool.id?.split('_').pop() || '';
          const mcap = parseFloat(attr.fdv_usd) || 0;

          const existing = coins.find(c => c.address === addr);
          if (!existing) {
            coins.push({
              symbol,
              name,
              address: addr,
              price: parseFloat(attr.base_token_price_usd) || 0,
              mcap,
              progress: Math.min((mcap / 69000) * 100, 100),
              graduated: dexId === 'raydium' || mcap >= 69000,
              isKing: false,
              replies: 0,
              image: null,
              created: attr.pool_created_at ? new Date(attr.pool_created_at).getTime() : now,
              age,
              url: `https://www.geckoterminal.com/solana/pools/${addr}`,
              volume24h: attr.volume_usd?.h24 ? parseFloat(attr.volume_usd.h24) : 0,
              liquidity: parseFloat(attr.reserve_in_usd) || 0,
              change24h: attr.price_change_percentage?.h24 ? parseFloat(attr.price_change_percentage.h24) : 0,
              dex: dexId
            });
          }
        });
      }
    } catch (e) {
      console.error('GeckoTerminal error:', e.message);
    }
  }

  return coins;
}

// Try pump.fun API (may be blocked)
async function fetchPumpFun() {
  try {
    const data = await fetchJSON('https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false');
    if (Array.isArray(data)) {
      const now = Date.now();
      return data.map(c => {
        const mcap = c.usd_market_cap || 0;
        return {
          symbol: c.symbol || '???',
          name: c.name || '',
          address: c.mint || '',
          price: parseFloat(c.price) || 0,
          mcap,
          progress: Math.min((mcap / 69000) * 100, 100),
          graduated: c.complete || c.raydium_pool || false,
          isKing: false,
          replies: c.reply_count || 0,
          image: c.image_uri || null,
          created: c.created_timestamp || now,
          age: c.created_timestamp ? now - c.created_timestamp : 0,
          url: `https://pump.fun/coin/${c.mint}`,
          volume24h: 0,
          liquidity: 0,
          dex: 'pumpfun'
        };
      });
    }
  } catch (e) {
    console.error('Pump.fun API error:', e.message);
  }
  return [];
}

// Aggregate all sources
async function fetchAllData() {
  const now = Date.now();
  if (now - lastFetch < CACHE_DURATION && pumpCoins.length > 0) {
    return pumpCoins;
  }

  console.log('Fetching data from all sources...');
  const seen = new Set();
  const coins = [];

  // Try all sources in parallel
  const [dexCoins, geckoCoins, pumpCoins_] = await Promise.all([
    fetchDexScreener().catch(() => []),
    fetchGeckoTerminal().catch(() => []),
    fetchPumpFun().catch(() => [])
  ]);

  // Merge all coins, preferring DexScreener data
  [...dexCoins, ...geckoCoins, ...pumpCoins_].forEach(c => {
    if (!seen.has(c.address)) {
      seen.add(c.address);
      coins.push(c);
    }
  });

  // Sort by creation time (newest first)
  coins.sort((a, b) => (a.age || Infinity) - (b.age || Infinity));

  pumpCoins = coins.slice(0, 150);
  lastFetch = now;
  console.log(`Fetched ${pumpCoins.length} coins total`);
  return pumpCoins;
}

// API endpoint
app.get('/api/pump', async (req, res) => {
  try {
    const coins = await fetchAllData();
    res.json({ success: true, count: coins.length, timestamp: Date.now(), coins });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Create server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.send(JSON.stringify({ type: 'initial', coins: pumpCoins, timestamp: Date.now() }));
  ws.on('close', () => console.log('Client disconnected'));
});

// Periodic updates
setInterval(async () => {
  await fetchAllData();
  if (wss.clients.size > 0) {
    broadcast({ type: 'update', coins: pumpCoins, timestamp: Date.now() });
  }
}, 10000);

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║          b.trade Backend Server           ║
╠═══════════════════════════════════════════╣
║  Open: http://localhost:${PORT}               ║
║  API:  http://localhost:${PORT}/api/pump      ║
╚═══════════════════════════════════════════╝
  `);
  fetchAllData();
});
