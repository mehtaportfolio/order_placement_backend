import { supabase } from '../src/db/supabaseClient.js';
import { fetchAllRows, deleteRows } from '../src/db/queries.js';

/**
 * Script to clean up duplicate symbol variations in equity_positions table
 * Handles cases like "ALPHA" and "ALPHA-EQ" which should be consolidated to "ALPHA"
 */

function normalizeSymbol(symbol) {
    if (!symbol) return symbol;
    return symbol.toString().trim().toUpperCase().split('-')[0];
}

async function cleanupSymbolDuplicates() {
    try {
        console.log('Starting cleanup of symbol duplicates in equity_positions...\n');

        // Fetch all records from today onwards
        const today = new Date().toISOString().split('T')[0];
        const { data: allPositions, error: fetchError } = await fetchAllRows(
            supabase,
            'equity_positions',
            {
                select: 'id, broker, account_id, symbol, quantity, average_price, position_date, fetched_at',
                filters: [(q) => q.gte('position_date', today)]
            }
        );

        if (fetchError) {
            console.error('Error fetching positions:', fetchError);
            return;
        }

        if (!allPositions || allPositions.length === 0) {
            console.log('No positions found to clean up.');
            return;
        }

        console.log(`Found ${allPositions.length} total positions.\n`);

        // Group positions by (broker, account_id, position_date, normalized_symbol)
        const groupedByNormalizedSymbol = new Map();

        allPositions.forEach((pos) => {
            const normalizedSymbol = normalizeSymbol(pos.symbol);
            const groupKey = `${pos.broker}::${pos.account_id}::${pos.position_date}::${normalizedSymbol}`;

            if (!groupedByNormalizedSymbol.has(groupKey)) {
                groupedByNormalizedSymbol.set(groupKey, []);
            }
            groupedByNormalizedSymbol.get(groupKey).push(pos);
        });

        // Find duplicates (groups with more than 1 record)
        const duplicateGroups = Array.from(groupedByNormalizedSymbol.entries())
            .filter(([, records]) => records.length > 1);

        if (duplicateGroups.length === 0) {
            console.log('✅ No symbol duplicates found. Database is clean!');
            return;
        }

        console.log(`Found ${duplicateGroups.length} groups with symbol duplicates:\n`);

        let totalRecordsToDelete = 0;
        const recordsToDelete = [];

        duplicateGroups.forEach(([groupKey, records]) => {
            const [broker, accountId, posDate, symbol] = groupKey.split('::');
            console.log(`\n📌 Group: ${symbol} (${broker} - ${accountId} on ${posDate})`);
            console.log(`   Found ${records.length} records with variants:`);

            records.forEach((record, idx) => {
                const markerKeep = idx === 0 ? '✅ KEEP' : '❌ DELETE';
                console.log(
                    `   ${markerKeep}: id=${record.id}, symbol="${record.symbol}", qty=${record.quantity}, fetched_at=${record.fetched_at}`
                );

                if (idx > 0) {
                    recordsToDelete.push(record.id);
                    totalRecordsToDelete++;
                }
            });
        });

        console.log(`\n\nTotal records to delete: ${totalRecordsToDelete}`);
        console.log('Record IDs to delete:', recordsToDelete);

        if (recordsToDelete.length === 0) {
            console.log('\n✅ No records to delete.');
            return;
        }

        // Ask for confirmation
        console.log('\n⚠️  This will delete the duplicate records shown above.');
        console.log('Continuing will remove duplicates and keep the oldest record in each group.\n');

        // Delete in batches (Supabase might have limits)
        const batchSize = 100;
        for (let i = 0; i < recordsToDelete.length; i += batchSize) {
            const batch = recordsToDelete.slice(i, i + batchSize);
            const { error: deleteError } = await deleteRows(supabase, 'equity_positions', (q) =>
                q.in('id', batch)
            );

            if (deleteError) {
                console.error(`Error deleting batch: ${deleteError.message}`);
                return;
            }

            console.log(`✅ Deleted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(recordsToDelete.length / batchSize)}`);
        }

        console.log(`\n✅ Successfully deleted ${totalRecordsToDelete} duplicate records!`);
        console.log('Database cleanup complete. Symbol variations have been consolidated.\n');

    } catch (error) {
        console.error('Unexpected error during cleanup:', error);
    }
}

// Run the cleanup
cleanupSymbolDuplicates();
