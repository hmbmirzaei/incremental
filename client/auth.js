import { apikey } from './config.js';
export const auth = (req, res, next) => {
    if (req.headers.apikey === apikey)
        return next();
    res.status(401).json('missing auth');
};
