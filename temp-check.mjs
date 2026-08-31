import dotenv from 'dotenv';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env.backend') });

import { supabase } from './src/db/supabaseClient.js';

const today = new Date().toISOString().split('T')[0];

console.log('Supabase client exists:', !!supabase);

const { data: positions, error: posErr } = await supabase
  .from('equity_positions')
  .select('id, broker, account_id, symbol, isin, quantity, average_price, last_price, position_date, exchange')
  .eq('position_date', today)
  .order('account_id');

console.log('positions error:', posErr);
console.log('positions rows:', positions?.length || 0);

for (const row of positions || []) {
  if ((row.symbol || '').toUpperCase() === 'HSCL' || (row.account_id || '').toUpperCase() === 'PM' || (row.account_id || '').toUpperCase() === 'PDM') {
    console.log('POSITION', JSON.stringify(row));
  }
}

const { data: tx, error: txErr } = await supabase
  .from('stock_transactions')
  .select('id, account_name, stock_name, buy_date, quantity, buy_price, sell_date, broker_name, equity_type, created_at')
  .order('created_at', { ascending: false })
  .limit(100);

console.log('tx error:', txErr);
console.log('tx rows:', tx?.length || 0);
for (const row of tx || []) {
  if ((row.stock_name || '').toUpperCase() === 'HSCL' || (row.account_name || '').toUpperCase() === 'PM' || (row.account_name || '').toUpperCase() === 'PDM') {
    console.log('TX', JSON.stringify(row));
  }
}
