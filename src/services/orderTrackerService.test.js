import { finalizeCompletedOrder, syncBrokerOrdersFromHistory } from './orderTrackerService.js';

function createQueryBuilder(resultData) {
  const builder = {
    is: () => builder,
    eq: () => builder,
    ilike: () => builder,
    order: () => ({
      limit: async () => ({ data: resultData, error: null }),
    }),
    limit: async () => ({ data: resultData, error: null }),
  };

  return builder;
}

describe('finalizeCompletedOrder', () => {
  it('splits a partial sell into a sold row and a remaining row', async () => {
    const updatedRows = [];
    const insertedRows = [];

    const existingRow = {
      id: 42,
      account_name: 'acct-1',
      account_type: 'CASH',
      equity_type: 'EQ',
      buy_date: '2025-01-01',
      sell_date: null,
      quantity: 13,
      buy_price: 100,
      sell_price: null,
      stock_name: 'HSCL',
      broker_name: 'zerodha',
    };

    const supabaseClient = {
      from(table) {
        if (table === 'stock_transactions') {
          return {
            select: () => ({
              eq: () => ({
                limit: async () => ({ data: [existingRow], error: null }),
              }),
            }),
            update: (values) => ({
              eq: async (column, value) => {
                updatedRows.push({ column, value, values });
                return { error: null };
              },
            }),
            insert: async (rows) => {
              insertedRows.push(rows);
              return { error: null };
            },
          };
        }

        if (table === 'broker_orders') {
          return {
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    };

    await finalizeCompletedOrder({
      supabaseClient,
      order: { transaction_id: 42, quantity: 10, price: 100 },
      statusData: { average_price: 105, status: 'COMPLETE' },
    });

    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0]).toMatchObject({
      column: 'id',
      value: 42,
      values: expect.objectContaining({
        quantity: 10,
        sell_date: expect.any(String),
        sell_price: 105,
      }),
    });

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0][0]).toMatchObject({
      quantity: 3,
      sell_date: null,
      sell_price: null,
      stock_name: 'HSCL',
    });
  });
});

describe('finalizeCompletedOrder FIFO matching', () => {
  it('settles a completed order across multiple matching rows in FIFO order', async () => {
    const insertedRows = [];
    const updatedRows = [];

    const matchingRows = [
      {
        id: 1,
        account_name: 'PDM',
        account_type: 'regular',
        equity_type: 'stock',
        buy_date: '2025-01-10',
        sell_date: null,
        quantity: 38,
        buy_price: 205.47,
        sell_price: null,
        stock_name: 'MOSCHIP',
        broker_name: 'zerodha',
      },
      {
        id: 2,
        account_name: 'PDM',
        account_type: 'regular',
        equity_type: 'stock',
        buy_date: '2025-01-28',
        sell_date: null,
        quantity: 20,
        buy_price: 162.45,
        sell_price: null,
        stock_name: 'MOSCHIP',
        broker_name: 'zerodha',
      },
    ];

    const supabaseClient = {
      from(table) {
        if (table === 'stock_transactions') {
          return {
            select: () => createQueryBuilder(matchingRows),
            update: (values) => ({
              eq: async (column, value) => {
                updatedRows.push({ column, value, values });
                return { error: null };
              },
            }),
            insert: async (rows) => {
              insertedRows.push(rows);
              return { error: null, data: rows };
            },
          };
        }

        if (table === 'broker_orders') {
          return {
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    };

    const result = await finalizeCompletedOrder({
      supabaseClient,
      order: {
        id: 99,
        transaction_id: null,
        broker: 'zerodha',
        account_id: 'PDM',
        symbol: 'MOSCHIP',
        quantity: 50,
        price: 211.6,
      },
      statusData: { average_price: 211.6, status: 'COMPLETE' },
    });

    expect(result.ok).toBe(true);
    expect(updatedRows).toHaveLength(2);
    expect(updatedRows[0]).toMatchObject({
      column: 'id',
      value: 1,
      values: expect.objectContaining({ quantity: 38, sell_date: expect.any(String), sell_price: 211.6 }),
    });
    expect(updatedRows[1]).toMatchObject({
      column: 'id',
      value: 2,
      values: expect.objectContaining({ quantity: 12, sell_date: expect.any(String), sell_price: 211.6 }),
    });
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0][0]).toMatchObject({
      quantity: 8,
      sell_date: null,
      sell_price: null,
      stock_name: 'MOSCHIP',
    });
  });
});

describe('syncBrokerOrdersFromHistory', () => {
  it('skips buy-side broker history entries and does not insert broker_orders rows', async () => {
    const insertedBrokerOrders = [];

    const supabaseClient = {
      from(table) {
        if (table === 'stock_transactions') {
          return {
            select: () => createQueryBuilder([]),
            update: () => ({
              eq: async () => ({ error: null }),
            }),
            insert: async () => ({ error: null, data: [] }),
          };
        }

        if (table === 'broker_orders') {
          return {
            select: () => createQueryBuilder([]),
            insert: async (rows) => {
              insertedBrokerOrders.push(rows);
              return { error: null, data: rows };
            },
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    };

    const summary = await syncBrokerOrdersFromHistory({
      supabaseClient,
      historyItems: [{
        order_id: 'buy-order-1',
        broker: 'zerodha',
        account_id: 'PM',
        symbol: 'RELIANCE',
        quantity: 10,
        price: 100,
        status: 'COMPLETE',
        average_price: 105,
        transaction_type: 'BUY',
      }],
    });

    expect(summary.inserted).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(insertedBrokerOrders).toHaveLength(0);
  });

  it('uses the order_id fallback when a newly inserted broker order has no id', async () => {
    const updatedRows = [];
    const updatedBrokerOrders = [];

    const existingRow = {
      id: 88,
      account_name: 'PDM',
      account_type: 'CASH',
      equity_type: 'EQ',
      buy_date: '2025-01-01',
      sell_date: null,
      quantity: 20,
      buy_price: 100,
      sell_price: null,
      stock_name: 'MOSCHIP',
      broker_name: 'zerodha',
    };

    const supabaseClient = {
      from(table) {
        if (table === 'stock_transactions') {
          return {
            select: () => createQueryBuilder([existingRow]),
            update: (values) => ({
              eq: async (column, value) => {
                updatedRows.push({ column, value, values });
                return { error: null };
              },
            }),
            insert: async () => ({ error: null, data: [] }),
          };
        }

        if (table === 'broker_orders') {
          return {
            select: () => createQueryBuilder([]),
            insert: async (rows) => ({ error: null, data: [] }),
            update: () => ({
              eq: async (column, value) => {
                updatedBrokerOrders.push({ column, value });
                if (column === 'id' && value == null) {
                  throw new Error('invalid input syntax for type uuid: "null"');
                }
                return { error: null };
              },
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    };

    await expect(syncBrokerOrdersFromHistory({
      supabaseClient,
      historyItems: [{
        order_id: 'order-789',
        broker: 'zerodha',
        account_id: 'PDM',
        symbol: 'MOSCHIP',
        quantity: 20,
        price: 100,
        status: 'COMPLETE',
        average_price: 105,
      }],
    })).resolves.toMatchObject({ inserted: 1 });

    expect(updatedBrokerOrders).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: 'order_id', value: 'order-789' }),
    ]));
  });

  it('matches a completed order using symbol and account when quantity does not match', async () => {
    const insertedBrokerOrders = [];
    const updatedRows = [];

    const existingRow = {
      id: 88,
      account_name: 'PDM',
      account_type: 'CASH',
      equity_type: 'EQ',
      buy_date: '2025-01-01',
      sell_date: null,
      quantity: 20,
      buy_price: 100,
      sell_price: null,
      stock_name: 'MOSCHIP',
      broker_name: 'zerodha',
    };

    const supabaseClient = {
      from(table) {
        if (table === 'stock_transactions') {
          return {
            select: () => createQueryBuilder([existingRow]),
            update: (values) => ({
              eq: async (column, value) => {
                updatedRows.push({ column, value, values });
                return { error: null };
              },
            }),
            insert: async (rows) => {
              return { error: null, data: rows };
            },
          };
        }

        if (table === 'broker_orders') {
          return {
            select: () => createQueryBuilder([]),
            insert: async (rows) => {
              insertedBrokerOrders.push(rows);
              return { error: null, data: rows };
            },
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    };

    const summary = await syncBrokerOrdersFromHistory({
      supabaseClient,
      historyItems: [{
        order_id: 'order-456',
        broker: 'zerodha',
        account_id: 'PDM',
        symbol: 'MOSCHIP',
        quantity: 58,
        price: 100,
        status: 'COMPLETE',
        average_price: 105,
      }],
    });

    expect(summary.inserted).toBe(1);
    expect(insertedBrokerOrders).toHaveLength(1);
    expect(insertedBrokerOrders[0][0]).toMatchObject({
      order_id: 'order-456',
      transaction_id: 88,
    });
    expect(updatedRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ values: expect.objectContaining({ sell_price: 105 }) })
    ]));
  });

  it('inserts a completed broker history order and finalizes the underlying transaction', async () => {
    const insertedBrokerOrders = [];
    const updatedRows = [];

    const existingRow = {
      id: 77,
      account_name: 'PM',
      account_type: 'CASH',
      equity_type: 'EQ',
      buy_date: '2025-01-01',
      sell_date: null,
      quantity: 10,
      buy_price: 100,
      sell_price: null,
      stock_name: 'RELIANCE',
      broker_name: 'zerodha',
    };

    const supabaseClient = {
      from(table) {
        if (table === 'stock_transactions') {
          return {
            select: () => createQueryBuilder([existingRow]),
            update: (values) => ({
              eq: async (column, value) => {
                updatedRows.push({ column, value, values });
                return { error: null };
              },
            }),
            insert: async (rows) => {
              return { error: null, data: rows };
            },
          };
        }

        if (table === 'broker_orders') {
          return {
            select: () => createQueryBuilder([]),
            insert: async (rows) => {
              insertedBrokerOrders.push(rows);
              return { error: null, data: rows };
            },
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    };

    const summary = await syncBrokerOrdersFromHistory({
      supabaseClient,
      historyItems: [{
        order_id: 'order-123',
        broker: 'zerodha',
        account_id: 'PM',
        symbol: 'RELIANCE',
        quantity: 10,
        price: 100,
        status: 'COMPLETE',
        average_price: 105,
      }],
    });

    expect(summary.inserted).toBe(1);
    expect(summary.updated).toBe(0);
    expect(insertedBrokerOrders).toHaveLength(1);
    expect(insertedBrokerOrders[0][0]).toMatchObject({
      order_id: 'order-123',
      status: 'COMPLETED',
      transaction_id: 77,
    });
    expect(updatedRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ values: expect.objectContaining({ sell_price: 105 }) })
    ]));
  });
});
