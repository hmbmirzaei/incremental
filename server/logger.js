// logger.js

import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { log_folder } from './config.js';

const log_dir = path.resolve(log_folder);
if (!fs.existsSync(log_dir))
    fs.mkdirSync(log_dir);

const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(info => {
                    const { timestamp, level, message, ...meta } = info;
                    return JSON.stringify({ timestamp, level, message, ...meta });
                })
            )
        }),
        new winston.transports.File({ filename: path.join(log_dir, 'app.log') })
    ]
});

export default logger;
