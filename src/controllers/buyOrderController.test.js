import { jest } from '@jest/globals';

const mockFetchAllRows = jest.fn();
const mockSupabase = {
  from: jest.fn(),
  rpc: jest.fn(),
};

jest.unstable_mockModule('../db/queries.js', () => ({
  fetchAllRows: mockFetchAllRows,
  insertRows: jest.fn(),
  updateRows: jest.fn(),
  deleteRows: jest.fn(),
  upsertRows: jest.fn(),
}));

jest.unstable_mockModule('../db/supabaseClient.js', () => ({
  supabase: mockSupabase,
}));

const { getStockMaster, savePositionsToTransactionsInternal } = await import('./buyOrderController.js');

describe('getStockMaster', () => {
  beforeEach(() => {
    mockFetchAllRows.mockReset();
    mockSupabase.from.mockReset();
    mockSupabase.rpc.mockReset();
  });

  it('includes exchange alongside the symbol token for each stock', async () => {
    mockFetchAllRows.mockResolvedValue({
      data: [{ stock_name: 'TCS', symbol_token: '12345', exchange: 'NSE' }],
      error: null,
    });

    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await getStockMaster({}, res);

    expect(mockFetchAllRows).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      stocks: [{ name: 'TCS', token: '12345', exchange: 'NSE' }],
    });
  });

  it('updates the existing same-day transaction when the synced position quantity grows', async () => {
    const today = '2026-07-28';
    mockFetchAllRows.mockResolvedValue({
      data: [{
        id: 10,
        broker: 'zerodha',
        account_id: 'PDM',
        symbol: 'CGCL',
        isin: null,
        quantity: 49,
        average_price: 120,
        last_price: 125,
        position_date: today,
        exchange: 'NSE',
      }],
      error: null,
    });

    const updateEq = jest.fn().mockResolvedValue({ error: null });
    mockSupabase.rpc.mockResolvedValue({ data: { inserted: 1 }, error: null });
    mockSupabase.from.mockImplementation((table) => {
      if (table === 'stock_transactions') {
        return {
          select: jest.fn().mockResolvedValue({
            data: [{ id: 99, account_name: 'PDM', equity_type: 'stock', buy_date: today, stock_name: 'CGCL', broker_name: 'zerodha', quantity: 40, buy_price: 100, sell_date: null }],
            error: null,
          }),
          update: jest.fn().mockReturnValue({ eq: updateEq }),
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      }

      if (table === 'stock_symbols') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({ data: null, error: new Error('missing') }),
                }),
              }),
            }),
          }),
        };
      }

      return {
        select: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    const result = await savePositionsToTransactionsInternal(today);

    expect(result.ok).toBe(true);
    expect(result.updated).toBe(1);
    expect(updateEq).toHaveBeenCalledWith('id', 99);
  });
});
