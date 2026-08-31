function parseQuantity(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function buildSellSettlementPlan({ existingRow, soldQuantity, sellDate, sellPrice }) {
  const originalQuantity = parseQuantity(existingRow?.quantity)
  const normalizedSoldQuantity = parseQuantity(soldQuantity)
  const normalizedSellDate = sellDate || null
  const normalizedSellPrice = sellPrice != null && sellPrice !== '' ? Number(sellPrice) : null

  const updatePayload = {
    sell_date: normalizedSellDate,
    sell_price: normalizedSellPrice,
  }

  if (normalizedSoldQuantity > 0 && normalizedSoldQuantity < originalQuantity) {
    updatePayload.quantity = normalizedSoldQuantity
  } else if (normalizedSoldQuantity >= originalQuantity) {
    updatePayload.quantity = originalQuantity
  }

  const remainingQuantity = Math.max(originalQuantity - normalizedSoldQuantity, 0)
  const remainingRow = remainingQuantity > 0 && normalizedSoldQuantity < originalQuantity
    ? {
        account_name: existingRow?.account_name,
        account_type: existingRow?.account_type,
        equity_type: existingRow?.equity_type,
        buy_date: existingRow?.buy_date,
        sell_date: null,
        quantity: remainingQuantity,
        buy_price: existingRow?.buy_price,
        sell_price: null,
        stock_name: existingRow?.stock_name,
        broker_name: existingRow?.broker_name,
      }
    : null

  return { updatePayload, remainingRow }
}
