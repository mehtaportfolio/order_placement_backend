import { supabase } from '../db/supabaseClient.js';

const RESTRICTED_STAGES = new Set(['BE', 'BZ']);
const RESTRICTED_SURVEILLANCE_TYPE = 'SERIES';

export async function getSurveillanceRestrictionForOrder({ symbol, orderType }) {
  const normalizedSymbol = String(symbol || '').trim();
  const normalizedOrderType = String(orderType || '').trim().toUpperCase();

  if (!normalizedSymbol) {
    return { isRestricted: false };
  }

  if (normalizedOrderType !== 'MARKET') {
    return { isRestricted: false };
  }

  try {
    const { data, error } = await supabase
      .from('stock_surveillance')
      .select('stock_name, surveillance_stage, surveillance_type')
      .ilike('stock_name', normalizedSymbol)
      .eq('surveillance_type', RESTRICTED_SURVEILLANCE_TYPE)
      .limit(1);

    if (error) {
      console.error('[surveillanceRestriction] Failed to check surveillance rules:', error.message);
      return { isRestricted: false };
    }

    const match = data?.[0];
    if (!match) {
      return { isRestricted: false };
    }

    const surveillanceStage = String(match.surveillance_stage || '').trim().toUpperCase();
    if (RESTRICTED_STAGES.has(surveillanceStage)) {
      return {
        isRestricted: true,
        message: `Please place a limit order for ${normalizedSymbol} because it is in the Trade-to-Trade category.`,
      };
    }

    return { isRestricted: false };
  } catch (error) {
    console.error('[surveillanceRestriction] Unexpected error:', error.message);
    return { isRestricted: false };
  }
}
