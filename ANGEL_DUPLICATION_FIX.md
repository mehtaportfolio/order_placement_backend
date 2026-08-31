# Angel One Position Duplication - Fix Documentation

## Problem Summary
When the sync button in the "Open Positions" tab was clicked multiple times, Angel One positions were being duplicated in the `equity_positions` table with symbol variations:
- "ALPHA" and "ALPHA-EQ" 
- "HDFCSML250" and "HDFCSML250-EQ"
- "MOMOMENTUM" and "MOMOMENTUM-EQ"  
- "MID150BEES" and "MID150BEES-EQ"

(Duplicates were correctly NOT appearing in `stock_transactions` table)

## Root Cause Analysis

The issue was in `angelOneService.js`, specifically in how `buildPositionSyncPlan()` handled symbol normalization:

1. **Symbol Normalization**: The `normalizeSymbol()` function strips "-EQ" suffix: `"ALPHA-EQ"` → `"ALPHA"`

2. **Map Overwriting Bug**: When creating `existingMap` with normalized symbols as keys:
   ```javascript
   const existingMap = new Map(
       (existingToday || []).map((row) => [normalizeSymbol(row.symbol), row])
   );
   ```
   If database had both "ALPHA" and "ALPHA-EQ" records, the second one would **overwrite** the first in the Map, losing duplicate detection.

3. **Concurrent Sync Issue**: Two rapid syncs could execute before comparing against existing records, both inserting the same position.

4. **Inconsistent Storage**: Symbols were stored in the database as-is (with "-EQ"), but compared using normalized values, causing mismatches.

## Solutions Implemented

### 1. **Enhanced Duplicate Detection** (`buildPositionSyncPlan`)
- Detect when multiple database records normalize to the same symbol
- Log and handle these duplicates explicitly
- Keep only the first occurrence, skip variants

### 2. **Pre-Sync Cleanup** (`fetchTodayBuyTrades`)
- Before comparison, identify all symbol variations in existing records
- Automatically delete duplicate variants (keeping the normalized one)
- Clean up happens before the sync plan is built

### 3. **UPSERT Logic Instead of INSERT/UPDATE**
- Changed from separate `insertRows()` and `updateRows()` calls
- Now uses `upsertRows()` with composite key: `(account_id, position_date, symbol)`
- Database-level constraint prevents duplicate inserts even with concurrent requests
- More robust and idempotent

### 4. **Normalized Symbol Storage**
- Symbols are now consistently normalized before storage
- "ALPHA-EQ" becomes "ALPHA" in the database
- Prevents creation of symbol variants in future syncs

## Code Changes

### File: `backend/src/services/angelOneService.js`

**Change 1: Updated `buildPositionSyncPlan()` function**
- Consolidates existing records with symbol variations
- Uses normalized symbol as the source of truth
- Logs when duplicate variants are detected

**Change 2: Added duplicate cleanup in `fetchTodayBuyTrades()`**
- Fetches records with full details including `id`
- Identifies records with same normalized symbol
- Deletes duplicates before comparison

**Change 3: Replaced INSERT/UPDATE with UPSERT**
- Uses `upsertRows()` with composite key
- Ensures "symbol is normalized"
- Prevents any duplicate inserts at database level

## Usage Instructions

### Step 1: Clean Up Existing Duplicates

Run the cleanup script to remove existing duplicates from your database:

```bash
cd backend
node scripts/cleanupSymbolDuplicates.js
```

**What it does:**
- Identifies all positions with symbol variants (e.g., "ALPHA" and "ALPHA-EQ")
- Groups them by normalized symbol
- Displays which records will be deleted
- Removes duplicate variants, keeping one record per normalized symbol

**Example output:**
```
Found 4 groups with symbol duplicates:

📌 Group: ALPHA (angel - P811882 on 2026-08-31)
   Found 2 records with variants:
   ✅ KEEP: id=abc123, symbol="ALPHA", qty=5, fetched_at=2026-08-31 03:58:43
   ❌ DELETE: id=def456, symbol="ALPHA-EQ", qty=5, fetched_at=2026-08-31 04:01:32

✅ Successfully deleted 4 duplicate records!
```

### Step 2: Test the Fix

Click the sync button multiple times in the "Open Positions" tab:
1. Positions should sync correctly
2. NO duplicate rows should appear
3. Quantities and prices should remain consistent

### Step 3: Verify in Database

Check that positions have:
- Normalized symbols (no "-EQ" suffix)
- No duplicate entries for the same symbol on the same date
- Correct quantities and average prices

## Database Constraint (Optional)

For additional safety, you can add a unique constraint in Supabase to enforce the composite key. In Supabase SQL editor:

```sql
-- Add unique constraint on normalized symbols
ALTER TABLE equity_positions
ADD CONSTRAINT unique_angel_position_per_day
UNIQUE (broker, account_id, symbol, position_date)
WHERE broker = 'angel' AND position_date >= CURRENT_DATE;
```

This ensures the database itself prevents duplicates at the constraint level.

## Future Prevention

The UPSERT logic with composite key will automatically:
- Prevent duplicate inserts on concurrent syncs
- Update positions when quantity/price changes
- Keep only one record per (account_id, position_date, symbol) combination

## Testing Checklist

- [ ] Run `cleanupSymbolDuplicates.js` to remove existing duplicates
- [ ] Click sync button once → verify positions appear correctly
- [ ] Click sync button again → verify NO duplicates are created
- [ ] Click sync multiple times rapidly → verify no race condition duplicates
- [ ] Verify quantities and prices are correct
- [ ] Verify `stock_transactions` table is NOT affected
- [ ] Check logs for any duplicate variant cleanup messages

## Rollback (if needed)

If you need to rollback the changes:
1. Restore backup of equity_positions table
2. Revert `angelOneService.js` to previous version
3. Clear browser cache

However, the new code is backward compatible and won't affect existing data structure.
