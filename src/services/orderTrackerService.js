import cron from 'node-cron';
import * as zerodhaService from './zerodhaService.js';
import * as angelService from './angelOneService.js';
import { supabase } from '../db/supabaseClient.js';

function normalizeBrokerName(broker) {
  return String(broker || '').trim().toLowerCase().replace(/\s+/g, '');
}

function getEffectiveSupabaseClient(supabaseClient) {
  return supabaseClient || supabase || null;
}

function normalizeOrderStatus(status) {
  const value = String(status || '').trim().toUpperCase();
  if (value === 'COMPLETE' || value === 'COMPLETED' || value === 'FILLED' || value === 'TRADED' || value === 'EXECUTED' || value === 'VALIDATED') {
    return 'COMPLETED';
  }
  if (value === 'OPEN' || value === 'PENDING' || value === 'TRIGGER PENDING' || value === 'AMO') {
    return 'OPEN';
  }
  if (value === 'REJECTED' || value === 'CANCELLED' || value === 'CANCELED') {
    return 'REJECTED';
  }
  return value || 'OPEN';
}

function parseQuantity(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getBrokerOrderUpdateTarget(order) {
  const rawId = order?.id;
  const normalizedId = String(rawId || '').trim();
  const hasUsableId = Boolean(normalizedId && normalizedId !== 'null' && normalizedId !== 'undefined');

  if (hasUsableId) {
    return { column: 'id', value: normalizedId };
  }

  const orderId = String(order?.order_id || order?.orderId || '').trim();
  if (orderId) {
    return { column: 'order_id', value: orderId };
  }

  return null;
}

async function resolveMatchingTransactionsForOrder({ supabaseClient = supabase, broker, account_id, symbol }) {
  const client = getEffectiveSupabaseClient(supabaseClient);
  if (!client) {
    return [];
  }

  const normalizedBroker = normalizeBrokerName(broker);
  const normalizedAccount = String(account_id || '').trim();
  const normalizedSymbol = String(symbol || '').trim();

  if (!normalizedSymbol) {
    return [];
  }

  let query = client.from('stock_transactions')
    .select('id, account_name, account_type, equity_type, buy_date, sell_date, quantity, buy_price, sell_price, stock_name, broker_name')
    .is('sell_date', null);

  if (normalizedAccount) {
    query = query.eq('account_name', normalizedAccount);
  }

  query = query.ilike('stock_name', `%${normalizedSymbol}%`);

  const { data, error } = await query.order('buy_date', { ascending: true }).limit(50);
  if (error) {
    console.error('[OrderTracker] Failed resolving stock transaction rows:', error.message);
    return [];
  }

  const ranked = (data || []).filter(Boolean).filter((row) => parseQuantity(row.quantity) > 0);
  return ranked;
}

async function resolveTransactionIdForOrder({ supabaseClient = supabase, broker, account_id, symbol, quantity }) {
  const matches = await resolveMatchingTransactionsForOrder({ supabaseClient, broker, account_id, symbol });
  if (matches.length === 0) {
    return null;
  }

  const normalizedBroker = normalizeBrokerName(broker);
  const normalizedSymbol = String(symbol || '').trim();
  const exactSymbolMatches = matches.filter((row) => {
    const rowStockName = String(row.stock_name || '').trim().toUpperCase();
    const brokerSymbol = normalizedSymbol.toUpperCase();
    return rowStockName && brokerSymbol && rowStockName.includes(brokerSymbol);
  });

  if (exactSymbolMatches.length > 0) {
    return exactSymbolMatches[0]?.id || null;
  }

  const brokerMatch = matches.find((row) => {
    const brokerName = String(row.broker_name || '').trim().toLowerCase();
    return brokerName && brokerName.includes(normalizedBroker);
  });
  if (brokerMatch) return brokerMatch.id;

  return matches[0]?.id || null;
}

export async function finalizeCompletedOrder({ supabaseClient = supabase, order, statusData }) {
  const client = getEffectiveSupabaseClient(supabaseClient);
  if (!client) {
    return { ok: false, reason: 'missing-supabase-client' };
  }

  const soldQuantity = parseQuantity(order?.quantity);
  const sellPrice = Number(statusData?.average_price || order?.price || 0);
  const sellDate = new Date().toISOString().split('T')[0];

  const matchingRows = await resolveMatchingTransactionsForOrder({
    supabaseClient: client,
    broker: order?.broker,
    account_id: order?.account_id,
    symbol: order?.symbol,
  });

  if (matchingRows.length > 0) {
    let remainingToSell = soldQuantity;
    const settledRows = [];

    for (const originalRow of matchingRows) {
      if (remainingToSell <= 0) break;

      const originalQuantity = parseQuantity(originalRow.quantity);
      if (originalQuantity <= 0) continue;

      const sharesToSettle = Math.min(originalQuantity, remainingToSell);
      const updatePayload = {
        sell_date: sellDate,
        sell_price: sellPrice,
        quantity: sharesToSettle,
      };

      const { error: updateError } = await client
        .from('stock_transactions')
        .update(updatePayload)
        .eq('id', originalRow.id);

      if (updateError) throw updateError;

      if (sharesToSettle < originalQuantity) {
        const remainingQuantity = originalQuantity - sharesToSettle;
        const remainingRow = {
          account_name: originalRow.account_name,
          account_type: originalRow.account_type,
          equity_type: originalRow.equity_type,
          buy_date: originalRow.buy_date,
          sell_date: null,
          quantity: remainingQuantity,
          buy_price: originalRow.buy_price,
          sell_price: null,
          stock_name: originalRow.stock_name,
          broker_name: originalRow.broker_name,
        };

        const { error: insertError } = await client
          .from('stock_transactions')
          .insert([remainingRow]);

        if (insertError) throw insertError;
      }

      remainingToSell -= sharesToSettle;
      settledRows.push({ id: originalRow.id, quantity: sharesToSettle });
    }

    const updateTarget = getBrokerOrderUpdateTarget(order);
    if (!updateTarget) {
      return { ok: true, originalRow: matchingRows[0], remainingQuantity: remainingToSell, settledRows };
    }

    const { error: brokerOrderError } = await client
      .from('broker_orders')
      .update({ status: 'COMPLETED', updated_at: new Date().toISOString() })
      .eq(updateTarget.column, updateTarget.value);

    if (brokerOrderError) throw brokerOrderError;

    return { ok: true, originalRow: matchingRows[0], remainingQuantity: remainingToSell, settledRows };
  }

  const transactionId = order?.transaction_id || null;
  if (!transactionId) {
    return { ok: false, reason: 'no-matching-stock-transactions-found' };
  }

  const { data: existingRows, error: fetchError } = await client
    .from('stock_transactions')
    .select('*')
    .eq('id', transactionId)
    .limit(1);

  if (fetchError) throw fetchError;

  const originalRow = existingRows?.[0];
  if (!originalRow) {
    return { ok: false, reason: 'missing-transaction-row' };
  }

  const alreadyFinalized = Boolean(originalRow.sell_date || originalRow.sell_price !== null && originalRow.sell_price !== undefined);
  if (alreadyFinalized) {
    const updateTarget = getBrokerOrderUpdateTarget(order);
    if (updateTarget) {
      await client
        .from('broker_orders')
        .update({ status: 'COMPLETED', updated_at: new Date().toISOString() })
        .eq(updateTarget.column, updateTarget.value);
    }
    return { ok: true, originalRow, remainingQuantity: parseQuantity(originalRow.quantity) };
  }

  const originalQuantity = parseQuantity(originalRow.quantity);
  const remainingQuantity = Math.max(originalQuantity - soldQuantity, 0);

  const updatePayload = {
    sell_date: sellDate,
    sell_price: sellPrice,
  };

  if (soldQuantity > 0 && soldQuantity < originalQuantity) {
    updatePayload.quantity = soldQuantity;
  } else if (soldQuantity >= originalQuantity) {
    updatePayload.quantity = originalQuantity;
  }

  const { error: updateError } = await client
    .from('stock_transactions')
    .update(updatePayload)
    .eq('id', transactionId);

  if (updateError) throw updateError;

  if (remainingQuantity > 0 && soldQuantity < originalQuantity) {
    const remainingRow = {
      account_name: originalRow.account_name,
      account_type: originalRow.account_type,
      equity_type: originalRow.equity_type,
      buy_date: originalRow.buy_date,
      sell_date: null,
      quantity: remainingQuantity,
      buy_price: originalRow.buy_price,
      sell_price: null,
      stock_name: originalRow.stock_name,
      broker_name: originalRow.broker_name,
    };

    const { error: insertError } = await client
      .from('stock_transactions')
      .insert([remainingRow]);

    if (insertError) throw insertError;
  }

  const updateTarget = getBrokerOrderUpdateTarget(order);
  if (!updateTarget) {
    return { ok: true, originalRow, remainingQuantity };
  }

  const { error: brokerOrderError } = await client
    .from('broker_orders')
    .update({ status: 'COMPLETED', updated_at: new Date().toISOString() })
    .eq(updateTarget.column, updateTarget.value);

  if (brokerOrderError) throw brokerOrderError;

  return { ok: true, originalRow, remainingQuantity };
}

export async function syncBrokerOrdersFromHistory({ supabaseClient = supabase, historyItems = [], broker = null, account_id = null } = {}) {
  const client = getEffectiveSupabaseClient(supabaseClient);
  if (!client) {
    return { inserted: 0, updated: 0, skipped: 0, reason: 'missing-supabase-client' };
  }

  const summary = { inserted: 0, updated: 0, skipped: 0, skippedReasons: [] };

  if (!Array.isArray(historyItems)) {
    return summary;
  }

  for (const item of historyItems) {
    const normalizedBroker = normalizeBrokerName(item.broker || broker);
    const normalizedAccount = String(item.account_id || account_id || '').trim();
    const normalizedSymbol = String(item.symbol || '').trim();
    const normalizedQuantity = Number(item.quantity || 0);
    const normalizedStatus = normalizeOrderStatus(item.status);
    const orderId = String(item.order_id || item.orderId || '').trim();
    const transactionType = String(item.transaction_type || item.order_type || '').trim().toUpperCase();
    const isSellOrder = transactionType === 'SELL' || transactionType === 'S' || transactionType === 'SHORT';

    if (!isSellOrder && transactionType) {
      summary.skipped += 1;
      summary.skippedReasons.push({
        order_id: orderId || null,
        reason: 'non-sell-order-history-entry',
        broker: normalizedBroker,
        account_id: normalizedAccount,
        symbol: normalizedSymbol,
        quantity: normalizedQuantity,
      });
      continue;
    }

    if (!orderId) {
      summary.skipped += 1;
      summary.skippedReasons.push({
        order_id: orderId || null,
        reason: 'missing-order-id',
        broker: normalizedBroker,
        account_id: normalizedAccount,
        symbol: normalizedSymbol,
        quantity: normalizedQuantity,
      });
      continue;
    }

    const { data: existingRows, error: existingError } = await client
      .from('broker_orders')
      .select('id, transaction_id, status, order_id, broker, account_id, symbol, quantity')
      .eq('order_id', orderId)
      .limit(1);

    if (existingError) throw existingError;

    const existingOrder = existingRows?.[0] || null;

    if (existingOrder) {
      const nextStatus = normalizeOrderStatus(existingOrder.status) === 'COMPLETED' ? 'COMPLETED' : normalizedStatus;
      if (existingOrder.status !== nextStatus) {
        const updateTarget = getBrokerOrderUpdateTarget(existingOrder);
        if (updateTarget) {
          await client
            .from('broker_orders')
            .update({ status: nextStatus, updated_at: new Date().toISOString() })
            .eq(updateTarget.column, updateTarget.value);
          summary.updated += 1;
        }
      }

      if (nextStatus === 'COMPLETED') {
        const transactionId = existingOrder.transaction_id || await resolveTransactionIdForOrder({
          supabaseClient,
          broker: normalizedBroker,
          account_id: normalizedAccount,
          symbol: normalizedSymbol,
          quantity: normalizedQuantity,
        });

        if (transactionId) {
          // Check if transaction is already finalized to prevent duplicate insertions
          const { data: txnCheck, error: txnCheckErr } = await client
            .from('stock_transactions')
            .select('id, sell_date, sell_price')
            .eq('id', transactionId)
            .limit(1);

          const isAlreadyFinalized = !txnCheckErr && txnCheck?.length > 0 && 
            (txnCheck[0].sell_date !== null || txnCheck[0].sell_price !== null);

          if (isAlreadyFinalized) {
            summary.skipped += 1;
            summary.skippedReasons.push({
              order_id: orderId,
              reason: 'already-processed',
              broker: normalizedBroker,
              account_id: normalizedAccount,
              symbol: normalizedSymbol,
              quantity: normalizedQuantity,
            });
            console.log(`[OrderTracker] Skipping re-finalization of broker_order ${orderId} (transaction already finalized)`);
          } else {
            const result = await finalizeCompletedOrder({
              supabaseClient,
              order: {
                ...existingOrder,
                transaction_id: transactionId,
                quantity: normalizedQuantity,
                price: item.average_price || item.price || 0,
              },
              statusData: {
                average_price: item.average_price || item.price || 0,
                status: nextStatus,
              },
            });
            if (result.ok) {
              summary.updated += 1;
            }
          }
        }
      }
      continue;
    }

    const resolvedTransactionId = await resolveTransactionIdForOrder({
      supabaseClient,
      broker: normalizedBroker,
      account_id: normalizedAccount,
      symbol: normalizedSymbol,
      quantity: normalizedQuantity,
    });

    if (!resolvedTransactionId && normalizedStatus === 'COMPLETED') {
      summary.skipped += 1;
      summary.skippedReasons.push({
        order_id: orderId,
        reason: 'no-matching-stock-transaction-found',
        broker: normalizedBroker,
        account_id: normalizedAccount,
        symbol: normalizedSymbol,
        quantity: normalizedQuantity,
      });
      continue;
    }

    const insertPayload = {
      order_id: orderId,
      broker: normalizedBroker || 'UNKNOWN',
      account_id: normalizedAccount,
      symbol: normalizedSymbol,
      quantity: normalizedQuantity,
      price: item.average_price || item.price || null,
      transaction_id: resolvedTransactionId,
      status: normalizedStatus,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (existingOrder) {
      summary.skipped += 1;
      summary.skippedReasons.push({
        order_id: orderId,
        reason: 'duplicate-broker-order',
        broker: normalizedBroker,
        account_id: normalizedAccount,
        symbol: normalizedSymbol,
        quantity: normalizedQuantity,
      });
      continue;
    }

    const { data: insertedRows, error: insertError } = await client
      .from('broker_orders')
      .insert([insertPayload]);

    if (insertError) throw insertError;

    const insertedOrder = insertedRows?.[0] || { id: null, ...insertPayload };
    summary.inserted += 1;

    if (normalizedStatus === 'COMPLETED' && resolvedTransactionId) {
      // Check if transaction is already finalized to prevent duplicate insertions
      const { data: txnCheck, error: txnCheckErr } = await client
        .from('stock_transactions')
        .select('id, sell_date, sell_price')
        .eq('id', resolvedTransactionId)
        .limit(1);

      const isAlreadyFinalized = !txnCheckErr && txnCheck?.length > 0 && 
        (txnCheck[0].sell_date !== null || txnCheck[0].sell_price !== null);

      if (isAlreadyFinalized) {
        console.log(`[OrderTracker] Skipping finalization of new broker_order ${orderId} (transaction already finalized)`);
      } else {
        await finalizeCompletedOrder({
          supabaseClient,
          order: {
            ...insertedOrder,
            transaction_id: resolvedTransactionId,
            quantity: normalizedQuantity,
            price: item.average_price || item.price || 0,
          },
          statusData: {
            average_price: item.average_price || item.price || 0,
            status: normalizedStatus,
          },
        });
      }
    }
  }

  return summary;
}

export async function syncBrokerOrdersFromBroker({ supabaseClient = supabase, broker, account_id } = {}) {
  const client = getEffectiveSupabaseClient(supabaseClient);
  if (!client) {
    return { inserted: 0, updated: 0, skipped: 0, reason: 'missing-supabase-client' };
  }
  const normalizedBroker = normalizeBrokerName(broker);

  if (normalizedBroker === 'zerodha') {
    const historyItems = await zerodhaService.getOrderHistory(account_id);
    return syncBrokerOrdersFromHistory({ supabaseClient, historyItems, broker: 'zerodha', account_id });
  }

  if (normalizedBroker === 'angel' || normalizedBroker === 'angelone') {
    const historyItems = await angelService.getOrderHistory();
    return syncBrokerOrdersFromHistory({ supabaseClient, historyItems, broker: 'angel', account_id });
  }

  throw new Error(`Unsupported broker for history sync: ${broker}`);
}

export async function syncBrokerOrdersFromBrokerAccounts({ supabaseClient = supabase } = {}) {
  const client = getEffectiveSupabaseClient(supabaseClient);
  if (!client) {
    return { inserted: 0, updated: 0, skipped: 0, accounts: [], reason: 'missing-supabase-client' };
  }

  const summary = { inserted: 0, updated: 0, skipped: 0, accounts: [], skippedReasons: [] };

  try {
    const { data: accountRows, error } = await client
      .from('zerodha_tokens')
      .select('account_id')
      .not('account_id', 'is', null);

    if (error) throw error;

    const accounts = [...new Set((accountRows || []).map((row) => String(row.account_id || '').trim()).filter(Boolean))];
    summary.accounts = accounts;

    for (const accountId of accounts) {
      try {
        const historyItems = await zerodhaService.getOrderHistory(accountId);
        if (!Array.isArray(historyItems)) {
          summary.skipped += 1;
          continue;
        }
        const accountSummary = await syncBrokerOrdersFromHistory({
          supabaseClient,
          historyItems,
          broker: 'zerodha',
          account_id: accountId,
        });

        summary.inserted += accountSummary.inserted;
        summary.updated += accountSummary.updated;
        summary.skipped += accountSummary.skipped;
        if (Array.isArray(accountSummary.skippedReasons)) {
          summary.skippedReasons.push(...accountSummary.skippedReasons);
        }
      } catch (err) {
        console.error(`[OrderTracker] Failed syncing Zerodha history for ${accountId}:`, err.message);
        summary.skipped += 1;
      }
    }
  } catch (err) {
    console.error('[OrderTracker] Failed syncing broker order history:', err.message);
  }

  return summary;
}

/**
 * Poll for open orders and update their status
 */
export async function trackOrders() {
  const client = getEffectiveSupabaseClient(supabase);
  if (!client) {
    return;
  }

  try {
    const { fetchAllRows } = await import('../db/queries.js');
    const { data: openOrders, error } = await fetchAllRows(client, 'broker_orders', {
      filters: [(q) => q.eq('status', 'OPEN')]
    });

    if (error) throw error;
    if (!openOrders || openOrders.length === 0) return;

    console.log(`[OrderTracker] Checking status for ${openOrders.length} open orders...`);

    for (const order of openOrders) {
      try {
        let statusData;
        if (normalizeBrokerName(order.broker) === 'zerodha') {
          statusData = await zerodhaService.getOrderStatus(order.account_id, order.order_id);
        } else {
          statusData = await angelService.getOrderStatus(order.order_id);
        }

        const normalizedStatus = normalizeOrderStatus(statusData.status);

        if (normalizedStatus === 'COMPLETED') {
          const result = await finalizeCompletedOrder({
            supabaseClient: supabase,
            order,
            statusData,
          });

          if (!result.ok) {
            throw new Error(result.reason || 'failed-to-finalize-order');
          }

          console.log(`[OrderTracker] Order ${order.order_id} COMPLETED and transaction updated.`);
        } else if (normalizedStatus === 'REJECTED') {
          const updateTarget = getBrokerOrderUpdateTarget(order);
          if (updateTarget) {
            await client
              .from('broker_orders')
              .update({ status: normalizedStatus, updated_at: new Date().toISOString() })
              .eq(updateTarget.column, updateTarget.value);
          }

          console.log(`[OrderTracker] Order ${order.order_id} ${normalizedStatus}.`);
        }
      } catch (err) {
        console.error(`[OrderTracker] Error tracking order ${order.order_id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[OrderTracker] Global tracking error:', err.message);
  }
}

/**
 * Start the order tracking background service
 */
export function startOrderTracker() {
  cron.schedule('*/1 * * * *', () => {
    trackOrders();
  });

  cron.schedule('*/5 * * * *', () => {
    syncBrokerOrdersFromBrokerAccounts().catch((err) => {
      console.error('[OrderTracker] Broker history sync error:', err.message);
    });
  });

  console.log('[OrderTracker] Background services started.');
}
