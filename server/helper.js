import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mongo } from './config.js';
import { lastOplog } from './config.js';
const { uri } = mongo;
export const execAsync = promisify(exec);

//oplog
export const Oplog = async () => {
    try {
        const client = new MongoClient(uri);
        await client.connect();
        const db = client.db("local");
        const oplog = db.collection('oplog.rs');
        return oplog;
    } catch (error) {
        throw 'error in database connection';
    }
};

// خواندن آخرین timestamp از فایل به صورت باینری
export const lastTsFile = async () => {
    try {
        const ts = await readFileSync(lastOplog);

        if (!ts.length)
            return false;
        const { t, i } = JSON.parse(ts);
        return { t, i };
    } catch (error) {
        if (error.code == 'ENOENT') {
            console.log('initial LAST OPLOG TIME not found');
            return false
        }
        console.log(`${error}`);
        return false;
    }
};

// خواندن آخرین timestamp از oplog
export const lastTsFromDB = async () => {
    try {
        const oplog = await Oplog();
        const lastRecord = await oplog.find().sort({ $natural: -1 }).limit(1).toArray();
        if (!lastRecord.length)
            return false

        const { ts } = lastRecord[0];  // استخراج timestamp از آخرین رکورد
        return { t: ts.getHighBits(), i: ts.getLowBits() };  // استخراج t و i

    } catch (error) {
        console.error('Error reading last timestamp from oplog:', error);
        return false;
    }
};

// ذخیره آخرین timestamp در فایل به صورت باینری
export const saveLastTs = async (ts) => {
    console.log({ ts })
    try {
        await writeFileSync(lastOplog, JSON.stringify({ t: ts.t, i: ts.i }));
        console.log('Last timestamp saved successfully');
    } catch (error) {
        console.error('Error saving last timestamp:', error);
    }
};

// Date and time helpers with validation
export const today_time = (date = new Date()) => {
    if (!(date instanceof Date) || isNaN(date)) 
        throw new Error('Invalid date provided');

    // تبدیل تاریخ به شمسی با ارقام انگلیسی
    let t = date
        .toLocaleDateString("fa-IR")
        .replace(/([۰-۹])/g, (token) =>
            String.fromCharCode(token.charCodeAt(0) - 1728)
        );

    t = t.split("/");
    if (t.length !== 3) 
        throw new Error('Invalid date format');

    const datePart = `${t[0]}-${t[1].padStart(2, '0')}-${t[2].padStart(2, '0')}`;

    // زمان: تبدیل به فرمت HH-mm-ss با ارقام انگلیسی
    let timePart = date
        .toLocaleTimeString("fa-IR", { hour12: false })
        .replace(/([۰-۹])/g, (token) =>
            String.fromCharCode(token.charCodeAt(0) - 1728)
        )
        .replace(/:/g, '-');

    return `${datePart}--${timePart}`;
};