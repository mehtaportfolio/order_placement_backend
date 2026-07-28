import { buildSellSettlementPlan } from './sellSettlementService.js'

describe('buildSellSettlementPlan', () => {
  it('returns a full-sell update when the sold quantity covers the whole holding', () => {
    const existingRow = {
      id: 'row-1',
      account_name: 'PM',
      account_type: 'CASH',
      equity_type: 'EQ',
      buy_date: '2026-01-01',
      quantity: 38,
      buy_price: 100,
      stock_name: 'Moschip',
      broker_name: 'Zerodha',
    }

    const plan = buildSellSettlementPlan({
      existingRow,
      soldQuantity: 38,
      sellDate: '2026-07-27',
      sellPrice: 120.5,
    })

    expect(plan.updatePayload).toEqual({
      sell_date: '2026-07-27',
      sell_price: 120.5,
      quantity: 38,
    })
    expect(plan.remainingRow).toBeNull()
  })

  it('splits a partial sell into a sold row and a remaining open row', () => {
    const existingRow = {
      id: 'row-1',
      account_name: 'PM',
      account_type: 'CASH',
      equity_type: 'EQ',
      buy_date: '2026-01-01',
      quantity: 38,
      buy_price: 100,
      stock_name: 'Moschip',
      broker_name: 'Zerodha',
    }

    const plan = buildSellSettlementPlan({
      existingRow,
      soldQuantity: 30,
      sellDate: '2026-07-27',
      sellPrice: 120.5,
    })

    expect(plan.updatePayload).toEqual({
      sell_date: '2026-07-27',
      sell_price: 120.5,
      quantity: 30,
    })
    expect(plan.remainingRow).toEqual({
      account_name: 'PM',
      account_type: 'CASH',
      equity_type: 'EQ',
      buy_date: '2026-01-01',
      sell_date: null,
      quantity: 8,
      buy_price: 100,
      sell_price: null,
      stock_name: 'Moschip',
      broker_name: 'Zerodha',
    })
  })
})
