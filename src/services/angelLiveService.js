import { SmartAPI, WebSocketV2 } from "smartapi-javascript";
import { WebSocketServer } from 'ws';
import cron from 'node-cron';
import { supabase } from '../db/supabaseClient.js';
import { fetchAllRows } from '../db/queries.js';
import { isMarketHours, login as angelLogin, sessionData as angelSession, invalidateSession } from './angelOneService.js';

let smartWS = null;
let lastTicks = {};
let wss = null;
let clients = new Set();
let tokenToSymbolMap = {};
let equityPositionSymbols = new Set();
let isLoggingIn = false;
let unknownSymbolsLogged = new Set();

const dynamicSubscriptions = new Map();

async function refreshEquityPositionSymbols() {
  try {
    const { data, error } = await fetchAllRows(supabase, 'equity_positions', {
      select: 'symbol'
    });

    if (error) {
      console.error('[Angel] Error refreshing equity position symbols:', error.message);
      return;
    }

    equityPositionSymbols = new Set((data || [])
      .map(row => row.symbol)
      .filter(Boolean));
    try {
      // Debug sample
      const sample = Array.from(equityPositionSymbols).slice(0, 10);
      console.log(`[Angel] Refreshed equityPositionSymbols (${equityPositionSymbols.size}) sample:`, sample);
    } catch (e) {}
    // If there are no equity positions, clear any stale token mappings and dynamic subscriptions
    if (equityPositionSymbols.size === 0) {
      tokenToSymbolMap = {};
      dynamicSubscriptions.clear();
      lastTicks = {};
      unknownSymbolsLogged.clear();
      console.log('[Angel] No equity positions: cleared tokenToSymbolMap, dynamicSubscriptions and cached ticks');
    }
  } catch (err) {
    console.error('[Angel] refreshEquityPositionSymbols error:', err.message);
  }
}

function normalizeSymbol(symbol) {
  if (!symbol) return symbol;

  symbol = symbol.trim();

  const normalized = symbol.toUpperCase().endsWith('-EQ')
    ? symbol.slice(0, -3)
    : symbol;

  return normalized.trim().toUpperCase();
}

async function getEquityPositionTokens() {
  try {
    const { data: positions, error: positionError } = await supabase
      .from('equity_positions')
      .select('symbol, exchange');

    if (positionError) {
      console.error('[Angel] Error fetching equity positions:', positionError.message);
      return [];
    }

const uniquePositions = Array.from(
  new Map(
    (positions || [])
      .filter((row) => row.symbol)
      .map((row) => [row.symbol.trim(), row])
  ).values()
);

if (uniquePositions.length === 0) {
  return [];
}

const symbols = uniquePositions.map((row) =>
  normalizeSymbol(row.symbol)
);

console.log(
  '[Angel] Sample position symbols:',
  uniquePositions.slice(0, 5).map((r) => r.symbol)
);

console.log(
  '[Angel] Normalized symbols:',
  symbols.slice(0, 5)
);

    // Query `stock_master` for tokens matching stock_name.
    // We normalize exchange values later, because stock_master may store null or lowercase exchange names.
    const tokenRows = [];
    try {
      // 1) Prefer `stock_symbols` table which contains normalized exchange tokens and symbol format (e.g., SGFIN-EQ)
      const names = symbols.map(s => s.toString().trim());
      const eqSymbols = names.map(n => `${n}-EQ`);

      let bySymbols = [];
      try {
        const { data: ssByName, error: ssNameErr } = await supabase
          .from('stock_symbols')
          .select('name, symbol, exchange, symbol_token')
          .in('name', names);
        if (!ssNameErr && ssByName && ssByName.length) {
          bySymbols.push(...ssByName.map(r => ({ stock_name: r.name, symbol_token: r.symbol_token, exchange: r.exchange, symbol: r.symbol })));
        }

        const { data: ssBySymbol, error: ssSymbolErr } = await supabase
          .from('stock_symbols')
          .select('name, symbol, exchange, symbol_token')
          .in('symbol', eqSymbols);
        if (!ssSymbolErr && ssBySymbol && ssBySymbol.length) {
          bySymbols.push(...ssBySymbol.map(r => ({ stock_name: r.name, symbol_token: r.symbol_token, exchange: r.exchange, symbol: r.symbol })));
        }
      } catch (e) {
        console.error('[Angel] Error fetching from stock_symbols:', e.message || e);
      }

      if (bySymbols && bySymbols.length) {
        tokenRows.push(...bySymbols);
      }

      // 2) For any remaining symbols not found in stock_symbols, fallback to stock_master
      const foundNames = new Set(tokenRows.map(r => r.stock_name && r.stock_name.toString().trim()));
      const remaining = names.filter(n => !foundNames.has(n));
      if (remaining.length > 0) {
        const { data: byName, error: byNameErr } = await supabase
          .from('stock_master')
          .select('stock_name, symbol_token, exchange, symbol')
          .in('stock_name', remaining);
        if (byNameErr) {
          console.error('[Angel] Error fetching from stock_master by stock_name:', byNameErr.message);
        } else if (byName && byName.length) {
          tokenRows.push(...byName.map(r => ({ stock_name: r.stock_name, symbol_token: r.symbol_token, exchange: r.exchange, symbol: r.symbol })));
        }
      }
    } catch (e) {
      console.error('[Angel] Error querying stock_master for tokens:', e.message || e);
      return [];
    }

    // Deduplicate by stock_name + exchange
    const seen = new Set();
    const uniqueTokenRows = (tokenRows || []).filter(r => {
      if (!r || !r.stock_name) return false;
      const key = `${(r.stock_name || '').toString().trim()}|${(r.exchange || 'NSE').toString().trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const tokenMap = new Map();
    uniqueTokenRows
      .filter((row) => row.stock_name && row.symbol_token)
      .forEach((row) => {
        const stockNameKey = row.stock_name.trim();
        const exchangeKey = ((row.exchange || 'NSE').toString().trim() || 'NSE').toUpperCase();
        const tokenData = { token: row.symbol_token.toString().trim(), exchange: exchangeKey };

        tokenMap.set(`${stockNameKey}|${exchangeKey}`, tokenData);
        tokenMap.set(stockNameKey, tokenData);
      });

    // Debug: log how many tokens were found vs requested
    try {
      const requested = symbols.slice(0, 20);
      const found = uniqueTokenRows.map(r => `${r.stock_name}|${r.exchange}`).slice(0, 20);
      console.log(`[Angel] getEquityPositionTokens: requested ${symbols.length}, found ${uniqueTokenRows?.length || 0} in stock_master`);
      console.log('[Angel] requested sample:', requested);
      console.log('[Angel] found sample (from stock_master):', found);
    } catch (e) {}

    return uniquePositions
      .map((row) => {
        const exchangeKey = ((row.exchange || 'NSE').toString().trim() || 'NSE').toUpperCase();
        const normalizedSymbol = normalizeSymbol(row.symbol);

const symbolData =
  tokenMap.get(`${normalizedSymbol}|${exchangeKey}`) ||
  tokenMap.get(normalizedSymbol);
     
return {
          symbol: row.symbol,
          token: symbolData?.token,
          exchange: row.exchange || symbolData?.exchange || 'NSE'
        };
      })
      .filter((item) => item.token);
  } catch (err) {
    console.error('[Angel] getEquityPositionTokens error:', err.message);
    return [];
  }
}



// --- LOGIN ---
export async function loginToAngel() {
  if (isLoggingIn) return;
  
  if (!isMarketHours()) {
    console.log("[Angel] Skipping login: Outside market hours (9:15 AM - 3:30 PM IST)");
    return null;
  }

  isLoggingIn = true;
  
  try {
    console.log("[Angel] Requesting login from AngelOneService...");
    const result = await angelLogin();

    if (!result.success || !angelSession) {
      console.error("❌ Angel One login failed via AngelOneService");
      isLoggingIn = false;
      return null;
    }

    // Start Angel WebSocket after successful login
    startAngelWS();
    
    isLoggingIn = false;
    return angelSession;
  } catch (err) {
    console.error("❌ Angel One login error:", err.message);
    isLoggingIn = false;
    return null;
  }
}

// --- ANGEL WEBSOCKET ---
export function stopAngelWS() {
  if (smartWS) {
    console.log("[Angel] Closing WebSocket connection (Market Hours Ended)");
    try {
      smartWS.close();
    } catch (e) {
      console.error("[Angel] Error closing WebSocket:", e.message);
    }
    smartWS = null;
  }
}

async function startAngelWS() {
  if (!angelSession) return;

  if (!isMarketHours()) {
    console.log("[Angel] Skipping WebSocket start: Outside market hours");
    return;
  }

  // Cleanup previous instance before reconnecting
  if (smartWS) {
    try {
      smartWS.close();
    } catch (e) {}
    smartWS = null;
  }

  const clientId = process.env.ANGEL_CLIENT_ID;
  const apiKey = process.env.ANGEL_API_KEY;
  const jwtToken = angelSession.jwtToken;
  const feedToken = angelSession.feedToken;

  if (!jwtToken || !feedToken) {
    console.error("❌ JWT or FeedToken missing. Cannot start Angel WebSocket.");
    return;
  }

  smartWS = new WebSocketV2({
    clientcode: clientId,
    jwttoken: jwtToken,
    apikey: apiKey,
    feedtype: feedToken
  });

  smartWS.connect().then(async () => {
    // Refresh the in-memory list of equity position symbols
    await refreshEquityPositionSymbols();

    // Add 1s delay to ensure SDK state is synchronized
    setTimeout(async () => {
      await subscribeToPortfolioStocks();
    }, 1000);
    
  }).catch(err => {
    console.error("❌ Angel WS connection error:", err);
    setTimeout(startAngelWS, 5000);
  });

  smartWS.on("tick", handleTick);

  smartWS.on("message", (data) => {
    try {
      const msg = typeof data === "string" ? JSON.parse(data) : data;
      handleTick(msg);
    } catch (e) {}
  });

  smartWS.on("close", () => {
    setTimeout(startAngelWS, 5000);
  });

  smartWS.on("error", (err) => {
    console.error("❌ Angel WS Error:", err);
    try {
      const msg = err && err.message ? err.message : String(err);
      if (msg.includes('401') || msg.includes('Unexpected server response: 401') || msg.toLowerCase().includes('unauthor')) {
        console.error('❌ Angel WS auth error (401). Invalidating session and restarting login.');
        try { invalidateSession(); } catch(e) {}
        try { if (smartWS) smartWS.close(); } catch(e) {}
        smartWS = null;
        setTimeout(() => {
          if (!isLoggingIn) loginToAngel();
        }, 2000);
      }
    } catch (e) {}
  });
}

// --- PORTFOLIO SUBSCRIPTION ---
async function subscribeToPortfolioStocks() {
  if (!smartWS) {
    return;
  }

  try {
    // Reset token->symbol mapping to avoid retaining stale tokens
    tokenToSymbolMap = {};

    // Subscribe only to symbols currently present in equity_positions
    const portfolioTokens = await getEquityPositionTokens();
const symbolTokens = [...portfolioTokens];

const uniqueSymbolTokens = Array.from(
  new Map(
    symbolTokens.map(item => [
      `${item.exchange}|${item.token}`,
      item
    ])
  ).values()
);

    if (symbolTokens.length === 0) {
      console.warn('[Angel] No equity position symbols found for subscription.');
      return;
    }

    const tokenList = [];
    const exchangeMap = {
      'NSE': 1,
      'BSE': 3
    };

    uniqueSymbolTokens.forEach((s) => {
  const exchangeType = exchangeMap[s.exchange] || 1;
  const token = s.token;

  tokenToSymbolMap[token] = s.symbol;

  let entry = tokenList.find(t => t.exchangeType === exchangeType);

  if (!entry) {
    entry = { exchangeType, tokens: [] };
    tokenList.push(entry);
  }

  entry.tokens.push(token);
});

    try {
      const mapSampleKeys = Object.keys(tokenToSymbolMap).slice(0, 10);
      console.log(`[Angel] subscribeToPortfolioStocks: built tokenToSymbolMap (${Object.keys(tokenToSymbolMap).length}) sample tokens:`, mapSampleKeys);
    } catch (e) {}

    if (tokenList.length === 0) {
      console.warn("[Angel] No matching tokens found for subscription.");
      return;
    }

    // Chunking logic: Angel One V2 has a limit (around 50 per call)
    const CHUNK_SIZE = 50;
    const DELAY = 200; // 200ms delay between chunks

    tokenList.forEach(item => {
      // Deduplicate tokens before subscription
      item.tokens = [...new Set(item.tokens)];
      
      for (let i = 0; i < item.tokens.length; i += CHUNK_SIZE) {
        const chunk = item.tokens.slice(i, i + CHUNK_SIZE);
        
        setTimeout(() => {
          if (!smartWS) return;
          
          const params = {
            correlationID: `portfolio_sync_${Date.now()}_${i}`,
            action: 1, // Subscribe
            mode: 3,   // Full mode
            tokenList: [
              {
                exchangeType: item.exchangeType,
                tokens: chunk
              }
            ]
          };

          // Detect the correct method (V2 usually uses subscribe, but some versions use fetchData)
          if (typeof smartWS.subscribe === 'function') {
            smartWS.subscribe(params);
          } else if (typeof smartWS.fetchData === 'function') {
            smartWS.fetchData({
              ...params,
              exchangeType: item.exchangeType,
              tokens: chunk
            });
          } else {
            console.error("❌ Angel WebSocket method not found (no subscribe or fetchData)");
          }
        }, i * (DELAY / CHUNK_SIZE)); // Spread out the delay based on chunk index
      }
    });

  } catch (err) {
    console.error("❌ Error subscribing to stocks:", err.message);
  }
}



async function resubscribeAllTokens() {

if (!smartWS) {
  console.warn('[Angel] smartWS is null, cannot resubscribe');
  return;
}
  const portfolioTokens = await getEquityPositionTokens();

  // Clear and rebuild token->symbol map so it only contains current subscriptions
  tokenToSymbolMap = {};

  const allTokens = [
    ...portfolioTokens,
    ...Array.from(dynamicSubscriptions.values())
  ];

  const uniqueTokens = Array.from(
    new Map(
      allTokens.map(item => [
        `${item.exchange}|${item.token}`,
        item
      ])
    ).values()
  );

  const tokenList = [];
  const exchangeMap = {
    NSE: 1,
    BSE: 3
  };

  uniqueTokens.forEach((s) => {
    // Ensure mapping reflects current set of tokens
    try {
      if (s && s.token && s.symbol) tokenToSymbolMap[s.token] = s.symbol;
    } catch (e) {}
    const exchangeType = exchangeMap[s.exchange] || 1;

    let entry = tokenList.find(
      t => t.exchangeType === exchangeType
    );

    if (!entry) {
      entry = {
        exchangeType,
        tokens: []
      };
      tokenList.push(entry);
    }

    entry.tokens.push(s.token);
  });

  console.log(
    '[Angel] Resubscribing total tokens:',
    uniqueTokens.length
  );

  tokenList.forEach(item => {
    item.tokens = [...new Set(item.tokens)];

    const params = {
      correlationID: `resync_${Date.now()}`,
      action: 1,
      mode: 3,
      tokenList: [
        {
          exchangeType: item.exchangeType,
          tokens: item.tokens
        }
      ]
    };


    if (typeof smartWS.subscribe === 'function') {
  smartWS.subscribe(params);
} else if (typeof smartWS.fetchData === 'function') {
  smartWS.fetchData({
    ...params,
    exchangeType: item.exchangeType,
    tokens: item.tokens
  });
} else {
  console.error(
    '[Angel] No subscribe or fetchData method found'
  );
}
  });
}

export async function subscribeSingleStock(symbol) {
  try {
    // Already receiving ticks
    if (lastTicks[symbol]) {
      return true;
    }

    const normalized = normalizeSymbol(symbol);

    let { data, error } = await supabase
      .from('stock_master')
      .select('stock_name, symbol_token, exchange')
      .ilike('stock_name', normalized)
      .single();

    if (error || !data) {
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('stock_master')
        .select('stock_name, symbol_token, exchange')
        .ilike('symbol', normalized)
        .single();

      if (fallbackError || !fallbackData) {
        console.error('[Angel] Stock not found:', symbol);
        return false;
      }

      data = fallbackData;
    }

    const token = data.symbol_token;
    const exchange = (data.exchange || 'NSE').toUpperCase();

    tokenToSymbolMap[token] = symbol;

dynamicSubscriptions.set(
  `${exchange}|${token}`,
  {
    symbol,
    token,
    exchange
  }
);

    const params = {
      correlationID: `single_${Date.now()}`,
      action: 1,
      mode: 3,
      tokenList: [
        {
          exchangeType: exchange === 'BSE' ? 3 : 1,
          tokens: [token]
        }
      ]
    };





if (!smartWS) {
  console.warn('[Angel] smartWS is null');
  return false;
}



await resubscribeAllTokens();

console.log(
  '[Angel] Subscribed token',
  token,
  'for',
  symbol
);

console.log(
  '[Angel] Dynamically subscribed:',
  symbol,
  token
);

return true;

 } catch (err) {
    console.error('[Angel] subscribeSingleStock error:', err);
    return false;
  }
}


// --- TICK HANDLING ---
async function updateEquityPositionLastPrice(symbol, lastPrice) {
  try {
    if (!equityPositionSymbols.has(symbol)) {
      return;
    }

    // Update open positions for this symbol (quantity > 0)
    const { error } = await supabase
      .from('equity_positions')
      .update({ last_price: lastPrice })
      .eq('symbol', symbol)
      .gt('quantity', 0);

    if (error) {
      console.error(`[Angel] Failed updating equity_positions.last_price for ${symbol}:`, error.message);
    }
  } catch (err) {
    console.error(`[Angel] Error updating equity_positions.last_price for ${symbol}:`, err.message);
  }
}

function handleTick(msg) {

      try {

        if (!msg) {
            console.log("msg is null");
            return;
        }

        if (!msg.token) {
            return;
        }

        const rawToken = msg.token.toString().replace(/"/g, '');
        const symbol = tokenToSymbolMap[rawToken] || rawToken;

        // Only log unknown symbols once to reduce noise
        const normalizedForCheck = normalizeSymbol(symbol);
        const dynamicSymbolNames = Array.from(dynamicSubscriptions.values()).map((item) => item.symbol);
        const isKnown = equityPositionSymbols.has(symbol) ||
          equityPositionSymbols.has(normalizedForCheck) ||
          equityPositionSymbols.has(normalizedForCheck + '-EQ') ||
          dynamicSymbolNames.includes(symbol) ||
          dynamicSymbolNames.includes(normalizedForCheck) ||
          dynamicSymbolNames.includes(normalizedForCheck + '-EQ');

        if (!isKnown) {
          if (!unknownSymbolsLogged.has(symbol)) {
            console.warn(`[Angel] Tick symbol '${symbol}' not found in equityPositionSymbols or dynamicSubscriptions (${equityPositionSymbols.size} equity symbols, ${dynamicSymbolNames.length} dynamic symbols). Ignoring.`);
            unknownSymbolsLogged.add(symbol);
          }
          return;
        }

        console.log('[Angel Tick]', rawToken, symbol, parseFloat(msg.last_traded_price) / 100);

        const tick = {
            symbol,
            ltp: parseFloat(msg.last_traded_price) / 100
        };

        const previousTick = lastTicks[symbol];
        const normalizedSymbol = normalizeSymbol(symbol);

        // Cache tick under normalized and -EQ forms too, to support UI lookups
        lastTicks[symbol] = tick;
        lastTicks[normalizedSymbol] = tick;
        lastTicks[`${normalizedSymbol}-EQ`] = tick;

        broadcast(tick);

        if (!previousTick || previousTick.ltp !== tick.ltp) {
            updateEquityPositionLastPrice(symbol, tick.ltp);
        }

    } catch (err) {
        console.error(err);
    }
}

// --- BROADCAST ---
function broadcast(tick) {
  clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      // If client has subscribed to specific symbols, filter
      if (!client.symbols || client.symbols.includes(tick.symbol)) {
        client.send(JSON.stringify(tick));
      }
    }
  });
}

// --- CLIENT WEBSOCKET SERVER ---
export function initLivePriceServer(server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url, `http://${request.headers.host}`);

    if (pathname === '/ws/live-prices') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on("connection", (ws) => {
    clients.add(ws);

    // Initial check if we need to login (only if market is open)
    if (!angelSession && !isLoggingIn) {
      if (isMarketHours()) {
        loginToAngel();
      } else {
        console.log("[Angel] Live price requested outside market hours. Skipping login.");
      }
    }

    ws.on("message", (msg) => {
      try {
        const data = JSON.parse(msg);
        if (data.type === "subscribe") {
          ws.symbols = data.symbols;
          
          // Send cached ticks immediately
          ws.symbols.forEach(symbol => {
            if (lastTicks[symbol]) {
              ws.send(JSON.stringify(lastTicks[symbol]));
            }
          });
        }
      } catch (err) {
        console.error("❌ Error handling client message:", err.message);
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });
    
    ws.on("error", (err) => {
      console.error("❌ Client WebSocket error:", err.message);
    });
  });

  // Schedule stop at 3:31 PM IST (Monday to Friday)
  cron.schedule('31 15 * * 1-5', () => {
    console.log("⏰ [Cron] Market hours ended. Stopping Angel One Live prices...");
    stopAngelWS();
  }, { timezone: "Asia/Kolkata" });

  // Schedule start at 9:15 AM IST (Monday to Friday)
  cron.schedule('15 9 * * 1-5', () => {
    console.log("⏰ [Cron] Market hours started. Checking Angel One Live prices...");
    if (angelSession) {
      if (!smartWS) {
        console.log("[Angel] Session exists, starting WebSocket...");
        startAngelWS();
      }
    } else if (!isLoggingIn) {
      console.log("[Angel] Session missing, logging in...");
      loginToAngel();
    }
  }, { timezone: "Asia/Kolkata" });

  // Periodic check during market hours to ensure we are connected (Every 5 mins)
  cron.schedule('*/5 9-15 * * 1-5', () => {
    if (isMarketHours()) {
      if (angelSession) {
        if (!smartWS) {
          console.log("⏰ [Cron] Market is open, session exists but WebSocket missing. Starting...");
          startAngelWS();
        }
      } else if (!isLoggingIn) {
        console.log("⏰ [Cron] Market is open but Angel session missing. Retrying login...");
        loginToAngel();
      }
    }
  }, { timezone: "Asia/Kolkata" });

  return wss;
}

export function getLivePrice(symbol) {
  return lastTicks[symbol]?.ltp || null;
}

export async function refreshAngelPositionSubscriptions() {
  try {
    await refreshEquityPositionSymbols();
    await subscribeToPortfolioStocks();
    console.log('[Angel] Refreshed live subscriptions after equity positions update');
  } catch (err) {
    console.error('[Angel] refreshAngelPositionSubscriptions error:', err.message);
  }
}
