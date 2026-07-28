import { jest } from '@jest/globals';

const mockSupabase = {
  from: jest.fn(),
};

const mockZerodhaService = {
  placeSellOrder: jest.fn(),
};

const mockAngelService = {
  placeSellOrder: jest.fn(),
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

jest.unstable_mockModule('../services/sellSettlementService.js', () => ({
  buildSellSettlementPlan: mockBuildSellSettlementPlan,
}));

import { placeSellOrder } from './orderController.js';

describe('placeSellOrder transaction resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildSellSettlementPlan.mockReturnValue({ updatePayload: {}, remainingRow: null });
  });

  it('accepts numeric transaction_ids from the sell UI', async () => {
    mockSupabase.from.mockImplementation((table) => {
      if (table === 'stock_transactions') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              is: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue({ data: [{ id: 12382 }], error: null }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === 'broker_orders') {
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
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
});
