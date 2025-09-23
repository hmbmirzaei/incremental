

// Import required modules for file operations, MongoDB timestamp, and BSON serialization
import { appendFileSync, unlinkSync, renameSync, statSync } from 'fs'; // Node.js file system
import { Timestamp } from 'mongodb'; // MongoDB timestamp for oplog
import { EJSON } from 'bson'; // Extended JSON for BSON serialization

// Import logger for structured logging
import logger from './logger.js';

// Import helper functions and configuration variables
import { Oplog, saveLastTs, lastTsFile, today_time } from './helper.js'; // Custom helpers
import { temp_file, unsynced } from './config.js' // Config values for temp file and backup folder


/**
 * Main IIFE to perform incremental backup from MongoDB oplog.
 * Reads new oplog entries since the last backup, writes them to a temp file,
 * then moves the file to the backup folder with a timestamped name.
 * Logs all important steps and errors.
 */
(async () => {
    try {
        // Fallback timestamp if no oplog found
        const now = { t: Math.floor(Date.now() / 1000), i: 0 };
        // Counters for different MongoDB operations
        let insert_count = 0;
        let update_count = 0;
        let delete_count = 0;

        // Log start of backup process
        logger.info('Starting incremental backup process');

        // Read last processed oplog timestamp from file
        const last_ts = await lastTsFile();
        logger.debug('Last timestamp loaded', { last_ts });

        // Build query to fetch only relevant oplog entries (skip system namespaces and no-ops)
        const query = {
            ns: { $not: /^admin\.|^local\.|^config\./ },
            op: { $ne: 'n' }
        };
        // If last_ts exists, only fetch newer entries
        if (last_ts) query.ts = { $gt: new Timestamp(last_ts) };

        // Get oplog collection and create a cursor for the query
        const oplog = await Oplog();
        const cursor = await oplog.find(query).sort({ $natural: 1 });

        // Remove previous temp file if it exists (cleanup from failed runs)
        try {
            unlinkSync(temp_file);
            logger.warn('Previous temp_file deleted', { temp_file });
        } catch {
            logger.debug('Previous temp_file did not exist', { temp_file });
        }

        // Create a new empty temp file to store oplog entries
        appendFileSync(temp_file, '');
        logger.debug('New temp_file created', { temp_file });
        let last_seen_ts;

        // Iterate through the oplog cursor and write each entry to the temp file
        while (await cursor.hasNext()) {
            const doc = await cursor.next();
            // Write oplog entry as EJSON to temp file
            appendFileSync(temp_file, EJSON.stringify(doc) + '\n');
            last_seen_ts = doc.ts;

            // Count operation types for reporting
            switch (doc.op) {
                case 'i': // Insert
                    insert_count++;
                    break;
                case 'u': // Update
                    update_count++;
                    break;
                case 'd': // Delete
                    delete_count++;
                    break;
            }
        }

        // Use last seen oplog timestamp, or fallback to now if none found
        const final_ts = last_seen_ts || now;
        // Construct the final backup file name with operation counts and timestamp
        const final_file_name = `${unsynced}/incremental-backup-${today_time()}-${final_ts.t}-${final_ts.i}-i${insert_count}-u${update_count}-d${delete_count.toLocaleString()}.jsonl`;
        // Move the temp file to the final backup file
        renameSync(temp_file, final_file_name);
        // Get the size of the backup file for reporting
        const { size } = statSync(final_file_name)
        // Save the last processed oplog timestamp for future incremental backups
        await saveLastTs(final_ts);
        // Log a summary of the backup
        logger.info('Incremental backup completed successfully', {
            insert_count,
            update_count,
            delete_count,
            file: final_file_name,
            size
        });
    } catch (error) {
        // Log any errors that occur during the backup process
        logger.error('Error in backup process', { error: error.message, stack: error.stack });
    }
})();