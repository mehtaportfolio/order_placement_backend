import { KiteConnect } from 'kiteconnect';
import { supabase } from '../db/supabaseClient.js';

// ===============================
// Get API key per account
// ===============================
function getApiKey(accountId) {
  if (accountId === 'PDM') return process.env.KITE_API_KEY_Z2;
  if (accountId === 'PSM') return process.env.KITE_API_KEY_Z3;
  return process.env.KITE_API_KEY_Z1;
}

// ===============================
// FETCH AND AGGREGATE TODAY'S OPEN POSITIONS FROM ORDERS
// ===============================
async function fetchAndAggregateTradesForAccount(accountId) {
  try {
    if (!accountId) {
      return { success: false, statusCode: 400, message: 'Account is required' };
    }

    if (!accountId) {
      return { success: false, statusCode: 400, message: 'Account is required' };
    }

    const { fetchAllRows } = await import('../db/queries.js');
    const { data: tokenDataArr, error: tokenError } = await fetchAllRows(supabase, 'zerodha_tokens', {
      select: 'access_token',
      filters: [(q) => q.eq('account_id', accountId)],
      limit: 1
    });

    const tokenData = tokenDataArr && tokenDataArr.length > 0 ? tokenDataArr[0] : null;

    if (tokenError || !tokenData) {
      return { success: false, statusCode: 400, message: 'No access token found. Please login first.' };
    }

    const kite = new KiteConnect({
      api_key: getApiKey(accountId),
      access_token: tokenData.access_token
    });

    const orders = await kite.getOrders();
    const today = new Date().toISOString().split('T')[0];

    const todayOrders = (orders || []).filter((order) => {
      const txnType = String(order.transaction_type || order.order_type || '').toUpperCase();
      if (!['BUY', 'SELL'].includes(txnType)) return false;

      const ts = order.order_timestamp || order.exchange_timestamp || order.fill_timestamp || order.updated_at || order.order_time;
      if (!ts) return false;

      try {
        return new Date(ts).toISOString().split('T')[0] === today;
      } catch (err) {
        return false;
      }
    });

    const lotBuckets = new Map();

    const isCompletedOrder = (order) => {
      const status = String(order.status || '').toUpperCase();
      return status === 'COMPLETE' || status === 'FILLED' || status === 'TRADED' || status === 'VALIDATED' || status === 'EXECUTED' || status === '';
    };

    const normalizeSymbol = (order) => order.tradingsymbol || order.symbol || order.trading_symbol || order.tradingSymbol || order.instrument || order.name || '';
    const normalizeQty = (order) => Number(order.filled_quantity ?? order.quantity ?? order.order_quantity ?? order.pending_quantity ?? 0);
    const normalizePrice = (order) => Number(order.average_price ?? order.price ?? order.fill_price ?? order.trigger_price ?? 0);

    for (const order of todayOrders) {
      if (!isCompletedOrder(order)) continue;

      const symbol = normalizeSymbol(order);
      const qty = normalizeQty(order);
      if (!symbol || qty <= 0) continue;

      const txnType = String(order.transaction_type || order.order_type || '').toUpperCase();
      const price = normalizePrice(order);
      const bucket = lotBuckets.get(symbol) || [];

      if (txnType === 'BUY') {
        bucket.push({ qty, price, ts: order.order_timestamp || order.exchange_timestamp || order.fill_timestamp || order.updated_at || order.order_time });
      } else if (txnType === 'SELL') {
        let remaining = qty;
        while (remaining > 0 && bucket.length > 0) {
          const lot = bucket[0];
          const consumed = Math.min(remaining, lot.qty);
          lot.qty -= consumed;
          remaining -= consumed;
          if (lot.qty <= 0) bucket.shift();
        }
      }

      lotBuckets.set(symbol, bucket);
    }

    const finalData = [];
    for (const [symbol, lots] of lotBuckets.entries()) {
      const remainingQty = lots.reduce((sum, lot) => sum + lot.qty, 0);
      if (remainingQty <= 0) continue;

      const weightedAverage = lots.reduce((sum, lot) => sum + (lot.qty * lot.price), 0) / remainingQty;
      finalData.push({
        broker: 'Zerodha',
        account_id: accountId,
        symbol,
        isin: null,
        quantity: Math.round(remainingQty),
        average_price: parseFloat(weightedAverage.toFixed(2)),
        product: 'CNC',
        exchange: 'NSE',
        position_date: today
      });
    }

    await supabase
      .from('equity_positions')
      .delete()
      .lt('position_date', today);

    const { data: existingToday } = await fetchAllRows(supabase, 'equity_positions', {
      select: 'symbol, quantity, average_price',
      filters: [
        (q) => q.eq('account_id', accountId),
        (q) => q.eq('position_date', today)
      ]
    });

    const existingMap = new Map((existingToday || []).map((r) => [r.symbol, r]));
    const dataToInsert = [];
    const dataToUpdate = [];

    finalData.forEach((item) => {
      const existing = existingMap.get(item.symbol);
      if (!existing) {
        dataToInsert.push(item);
      } else if (
        Number(existing.quantity) !== Number(item.quantity) ||
        Number(existing.average_price) !== Number(item.average_price)
      ) {
        dataToUpdate.push(item);
      }
    });

    if (dataToInsert.length > 0) {
      const { error: insertError } = await supabase.from('equity_positions').insert(dataToInsert);
      if (insertError) {
        console.error('❌ Insert Error:', insertError.message, 'Data:', dataToInsert);
        return { success: false, statusCode: 500, message: `Failed to save aggregated trades: ${insertError.message}` };
      }
    }

    if (dataToUpdate.length > 0) {
      for (const item of dataToUpdate) {
        const { error: updateError } = await supabase
          .from('equity_positions')
          .update({ quantity: item.quantity, average_price: item.average_price })
          .match({ account_id: accountId, position_date: today, symbol: item.symbol });

        if (updateError) {
          console.error('❌ Update Error:', updateError.message, 'Data:', item);
        }
      }
    }

    return {
      success: true,
      message:
        dataToInsert.length > 0 || dataToUpdate.length > 0
          ? `Successfully processed ${dataToInsert.length} new and ${dataToUpdate.length} updated stocks`
          : 'All stocks already exist for today',
      data: [...dataToInsert, ...dataToUpdate],
      orders: todayOrders,
      formatted: finalData,
      inserted: dataToInsert.length,
      updated: dataToUpdate.length,
      today
    };
  } catch (err) {
    console.error('❌ Fetch/Aggregate error:', err.message);
    return { success: false, statusCode: 500, message: `Aggregation failed: ${err.message}` };
  }
}

async function fetchAndAggregateTrades(req, res) {
  const { account: accountId } = req.query;
  const result = await fetchAndAggregateTradesForAccount(accountId);
  if (!result.success) {
    return res.status(result.statusCode || 500).json(result);
  }
  return res.json(result);
}

// ===============================
// PLACE BUY ORDER
// ===============================
async function placeBuyOrder(accountId, symbol, quantity, orderType, price) {
  try {
    if (!accountId) throw new Error("Account is required");

    const { fetchAllRows } = await import('../db/queries.js');
    const { data: tokenDataArr } = await fetchAllRows(supabase, "zerodha_tokens", {
      select: "access_token",
      filters: [(q) => q.eq("account_id", accountId)],
      limit: 1
    });

    const tokenData = tokenDataArr && tokenDataArr.length > 0 ? tokenDataArr[0] : null;

    if (!tokenData) throw new Error("No access token found for Zerodha");

    const kite = new KiteConnect({
      api_key: getApiKey(accountId),
      access_token: tokenData.access_token
    });

    const orderPayload = {
      exchange: "NSE",
      tradingsymbol: symbol,
      transaction_type: "BUY",
      quantity: quantity,
      order_type: orderType,
      product: "CNC"
    };

    if (orderType === "LIMIT") {
      orderPayload.price = price;
    } else if (orderType === "MARKET") {
      // Market protection disabled for market orders (-1 = unrestricted)
      orderPayload.market_protection = -1;
    }

    const orderResponse = await kite.placeOrder("regular", orderPayload);

    return {
      success: true,
      order_id: orderResponse.order_id
    };
  } catch (err) {
    console.error(`❌ Zerodha placeBuyOrder error for ${symbol}:`, err.message);
    throw err;
  }
}

// ===============================
// PLACE SELL ORDER
// ===============================
async function placeSellOrder(accountId, symbol, quantity, orderType, price) {
  try {
    if (!accountId) throw new Error("Account is required");

    const { fetchAllRows } = await import('../db/queries.js');
    const { data: tokenDataArr } = await fetchAllRows(supabase, "zerodha_tokens", {
      select: "access_token",
      filters: [(q) => q.eq("account_id", accountId)],
      limit: 1
    });

    const tokenData = tokenDataArr && tokenDataArr.length > 0 ? tokenDataArr[0] : null;

    if (!tokenData) throw new Error("No access token found for Zerodha");

    const kite = new KiteConnect({
      api_key: getApiKey(accountId),
      access_token: tokenData.access_token
    });

    const orderPayload = {
      exchange: "NSE",
      tradingsymbol: symbol,
      transaction_type: "SELL",
      quantity: quantity,
      order_type: orderType === "MARKET" ? "MARKET" : "LIMIT",
      product: "CNC"
    };

    if (orderType === "LIMIT") {
      orderPayload.price = price;
    } else if (orderType === "MARKET") {
      orderPayload.market_protection = -1;
    }

    const orderResponse = await kite.placeOrder("regular", orderPayload);

    return {
      success: true,
      order_id: orderResponse.order_id,
      status: orderResponse.status,
      executed_price: orderResponse.average_price || orderResponse.price || null
    };
  } catch (err) {
    console.error(`❌ Zerodha placeOrder error for ${symbol}:`, err.message);
    throw err;
  }
}

// ===============================
// GET ORDER STATUS
// ===============================
async function getOrderStatus(accountId, orderId) {
  try {
    if (!accountId) throw new Error("Account is required");

    const { fetchAllRows } = await import('../db/queries.js');
    const { data: tokenDataArr } = await fetchAllRows(supabase, "zerodha_tokens", {
      select: "access_token",
      filters: [(q) => q.eq("account_id", accountId)],
      limit: 1
    });

    const tokenData = tokenDataArr && tokenDataArr.length > 0 ? tokenDataArr[0] : null;

    if (!tokenData) throw new Error("No access token found");

    const kite = new KiteConnect({
      api_key: getApiKey(accountId),
      access_token: tokenData.access_token
    });

    const orders = await kite.getOrderHistory(orderId);
    // Get latest status
    const latestOrder = orders[orders.length - 1];

    return {
      status: latestOrder.status, // OPEN, COMPLETE, REJECTED, CANCELLED
      average_price: latestOrder.average_price,
      filled_quantity: latestOrder.filled_quantity,
      status_message: latestOrder.status_message
    };
  } catch (err) {
    console.error(`❌ Zerodha getOrderStatus error:`, err.message);
    throw err;
  }
}

// ===============================
// EXPORT
// ===============================
export {
  fetchAndAggregateTrades,
  fetchAndAggregateTradesForAccount,
  placeBuyOrder,
  placeSellOrder,
  getOrderStatus
};
