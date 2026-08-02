'use strict';
const { Router } = require('express');
const { timingSafeEqual } = require('crypto');
const asyncHandler = require('../helpers/async-handler');
const metrics = require('../utils/metrics.util');
const router = Router();
const authorized = (req) => {
    const expected = process.env.METRICS_TOKEN || '';
    const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    if (!expected || suppliedBuffer.length !== expectedBuffer.length) {
        return false;
    }
    return timingSafeEqual(suppliedBuffer, expectedBuffer);
};
router.get(
    '/',
    asyncHandler(async (req, res) => {
        if (process.env.METRICS_ENABLED !== 'true') {
            return res.status(404).end();
        }
        if (!authorized(req)) {
            res.set('WWW-Authenticate', 'Bearer realm="metrics"');
            return res.status(401).end();
        }
        res.set({
            'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        return res.status(200).send(await metrics.render());
    }),
);
module.exports = router;
