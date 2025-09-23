import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mongo } from './config.js';
import { lastOplog } from './config.js';
import logger from './logger.js';
const { uri } = mongo;
export const execAsync = promisify(exec);

// Get a handle to the MongoDB oplog collection
export const Oplog = async () => {
    try {
        const client = new MongoClient(uri);
        await client.connect();
        const db = client.db("local");
        const oplog = db.collection('oplog.rs');
        return oplog;
    } catch (error) {
        logger.error('Error connecting to MongoDB for oplog', { error: error.message });
        throw new Error('error in database connection');
    }
};

// Read the last processed oplog timestamp from file
export const lastTsFile = async () => {
    try {
        const ts = await readFileSync(lastOplog);

        if (!ts.length)
            return false;
        const { t, i } = JSON.parse(ts);
        return { t, i };
    } catch (error) {
        if (error.code == 'ENOENT') {
            logger.warn('Initial last-oplog timestamp file not found', { file: lastOplog });
            return false
        }
        logger.error('Error reading last-oplog timestamp file', { error: error.message });
        return false;
    }
};

// Read the latest timestamp directly from the oplog
export const lastTsFromDB = async () => {
    try {
        const oplog = await Oplog();
        const lastRecord = await oplog.find().sort({ $natural: -1 }).limit(1).toArray();
        if (!lastRecord.length)
            return false

        const { ts } = lastRecord[0];  // timestamp of the last record
        return { t: ts.getHighBits(), i: ts.getLowBits() };  // extract t and i

    } catch (error) {
        logger.error('Error reading last timestamp from oplog', { error: error.message });
        return false;
    }
};

// Persist the last processed oplog timestamp into file
export const saveLastTs = async (ts) => {
    try {
        await writeFileSync(lastOplog, JSON.stringify({ t: ts.t, i: ts.i }));
        logger.info('Last timestamp saved successfully', { t: ts.t, i: ts.i, file: lastOplog });
    } catch (error) {
        logger.error('Error saving last timestamp', { error: error.message });
    }
};

// Date and time helpers with validation
export const today_time = (date = new Date()) => {
    if (!(date instanceof Date) || isNaN(date)) 
        throw new Error('Invalid date provided');

    // Convert date to Persian calendar using English digits
    let t = date
        .toLocaleDateString("fa-IR")
        .replace(/([۰-۹])/g, (token) =>
            String.fromCharCode(token.charCodeAt(0) - 1728)
        );

    t = t.split("/");
    if (t.length !== 3) 
        throw new Error('Invalid date format');

    const datePart = `${t[0]}-${t[1].padStart(2, '0')}-${t[2].padStart(2, '0')}`;

    // Time: convert to HH-mm-ss with English digits
    let timePart = date
        .toLocaleTimeString("fa-IR", { hour12: false })
        .replace(/([۰-۹])/g, (token) =>
            String.fromCharCode(token.charCodeAt(0) - 1728)
        )
        .replace(/:/g, '-');

    return `${datePart}--${timePart}`;
};