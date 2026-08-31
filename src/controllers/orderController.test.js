import { jest } from '@jest/globals';

const mockSupabase = {
  from: jest.fn(),
};

const mockZerodhaService = {
  placeSellOrder: jest.fn(),
};

const mockAngelService = {
  placeSellOrder: jest.fn(),
  login: jest.fn(),
  sessionData: {},
  invalidateSession: jest.fn(),
  getAngelStatus: jest.fn(() => ({ ok: true })),
};

const mockSurveillanceRestriction = {
  getSurveillanceRestrictionForOrder: jest.fn(),
};

const mockBuildSellSettlementPlan = jest.fn();

jest.unstable_mockModule('../db/supabaseClient.js', () => ({
  supabase: mockSupabase,
}));

jest.unstable_mockModule('../services/zerodhaService.js', () => ({
  ...mockZerodhaService,
}));

jest.unstable_mockModule('../services/angelOneService.js', () => ({
  ...mockAngelService,
}));

jest.unstable_mockModule('../services/angelLiveService.js', () => ({
  getLivePrice: jest.fn(),
  subscribeSingleStock: jest.fn(),
  fetchFreshLivePrice: jest.fn(),
}));

jest.unstable_mockModule('../services/sellSettlementService.js', () => ({
  buildSellSettlementPlan: mockBuildSellSettlementPlan,
}));

jest.unstable_mockModule('../utils/surveillanceRestriction.js', () => ({
  getSurveillanceRestrictionForOrder: mockSurveillanceRestriction.getSurveillanceRestrictionForOrder,
}));

const { placeSellOrder, getLivePrice } = await import('./orderController.js');

function createQueryBuilder(result) {
  const builder = {};
  builder.eq = jest.fn().mockReturnValue(builder);
  builder.is = jest.fn().mockReturnValue(builder);
  builder.order = jest.fn().mockReturnValue(builder);
  builder.limit = jest.fn().mockResolvedValue(result);
  builder.single = jest.fn().mockResolvedValue(result);
  builder.range = jest.fn().mockResolvedValue(result);
  return builder;
}

describe('placeSellOrder transaction resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildSellSettlementPlan.mockReturnValue({ updatePayload: {}, remainingRow: null });
    mockSurveillanceRestriction.getSurveillanceRestrictionForOrder.mockResolvedValue({ isRestricted: false });
  });

  it('accepts numeric transaction_ids from the sell UI', async () => {
    mockSupabase.from.mockImplementation((table) => {
      if (table === 'stock_transactions') {
        const transactionQuery = createQueryBuilder({ data: [{ id: 12382 }], error: null });
        return {
          select: jest.fn().mockReturnValue(transactionQuery),
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: null }),
          }),
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      }

      if (table === 'broker_orders') {
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      }

      if (table === 'equity_positions') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
          delete: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: null }),
          }),
        };
      }

      if (table === 'stock_master') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [{ symbol_token: '12345', exchange: 'NSE' }],
                error: null,
              }),
            }),
          }),
        };
      }

      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null }),
        }),
      };
    });

    mockZerodhaService.placeSellOrder.mockResolvedValue({ success: true, order_id: 'order-1' });
    mockAngelService.placeSellOrder.mockResolvedValue({ success: true, order_id: 'order-2' });

    const req = {
      body: {
        broker: 'zerodha',
        account_id: 'PDM',
        symbol: 'ADSL',
        quantity: 1,
        transaction_id: 12382,
        order_type: 'MARKET',
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await placeSellOrder(req, res);

    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(mockZerodhaService.placeSellOrder).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('forwards the selected exchange for BSE sell orders', async () => {
    mockSupabase.from.mockImplementation((table) => {
      if (table === 'stock_transactions') {
        const transactionQuery = createQueryBuilder({ data: [{ id: 12382 }], error: null });
        return {
          select: jest.fn().mockReturnValue(transactionQuery),
          update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      }

      if (table === 'broker_orders') {
        return { insert: jest.fn().mockResolvedValue({ error: null }) };
      }

      if (table === 'equity_positions') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
          delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        };
      }

      if (table === 'stock_master') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [{ symbol_token: '12345', exchange: 'BSE' }],
                error: null,
              }),
            }),
          }),
        };
      }

      return { select: jest.fn() };
    });

    mockZerodhaService.placeSellOrder.mockResolvedValue({ success: true, order_id: 'bse-order-1' });

    const req = {
      body: {
        broker: 'zerodha',
        account_id: 'PDM',
        symbol: 'AXTEL',
        quantity: 1,
        transaction_id: 12382,
        order_type: 'LIMIT',
        price: 100,
        exchange: 'BSE',
      },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await placeSellOrder(req, res);

    expect(mockZerodhaService.placeSellOrder).toHaveBeenCalledWith(
      'PDM', 'AXTEL', 1, 'LIMIT', 100, 'BSE'
    );
  });

  it('blocks market sell orders for trade-to-trade surveillance stocks', async () => {
    mockSurveillanceRestriction.getSurveillanceRestrictionForOrder.mockResolvedValue({
      isRestricted: true,
      message: 'Please place a limit order for ABC because it is in the Trade-to-Trade category.',
    });

    const req = {
      body: {
        broker: 'zerodha',
        account_id: 'PDM',
        symbol: 'ABC',
        quantity: 1,
        order_type: 'MARKET',
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await placeSellOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Please place a limit order for ABC because it is in the Trade-to-Trade category.' });
    expect(mockZerodhaService.placeSellOrder).not.toHaveBeenCalled();
  });

  it('prefers a fresh broker-backed price over a stale cached LTP', async () => {
    const mockGetLivePrice = jest.fn().mockReturnValue(7777);
    const mockFetchFreshLivePrice = jest.fn().mockResolvedValue(6312);

    const angelLiveServiceModule = await import('../services/angelLiveService.js');
    angelLiveServiceModule.getLivePrice.mockImplementation(mockGetLivePrice);
    angelLiveServiceModule.fetchFreshLivePrice.mockImplementation(mockFetchFreshLivePrice);

    const req = {
      params: { symbol: 'MTARTECH-EQ' },
      query: {},
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await getLivePrice(req, res);

    expect(mockFetchFreshLivePrice).toHaveBeenCalledWith('MTARTECH-EQ', { exchange: undefined, stockName: 'MTARTECH-EQ' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, ltp: 6312 }));
  });
});
