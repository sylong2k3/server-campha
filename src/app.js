const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const passport = require('passport');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middlewares/error-handler');
const { initPassport } = require('./configs/passport');
const localeMiddleware = require('./middlewares/locale.middleware');
const { t } = require('./utils/i18n.util');

initPassport();

const app = express();
app.disable('x-powered-by');

// Chặn sớm các request dò quét file nhạy cảm (.env, .git, path traversal)
// trước khi tới router, tránh lộ thông tin và giảm rác log lỗi 404.
const BLOCKED_PATH_PATTERN = /(^|\/)\.env(\.|$|\?)|\.git(\/|$)|\.\.\//i;
app.use((req, res, next) => {
    if (BLOCKED_PATH_PATTERN.test(req.originalUrl)) {
        return res.status(403).end();
    }
    next();
});

const trustProxy = process.env.TRUST_PROXY;
if (trustProxy === 'true') {
    app.set('trust proxy', true);
} else if (/^\d+$/.test(trustProxy || '')) {
    app.set('trust proxy', Number(trustProxy));
} else if (trustProxy && trustProxy !== 'false') {
    app.set(
        'trust proxy',
        trustProxy
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
    );
}

const corsOrigins = process.env.CORS_ORIGINS || '*';
let allowedOrigins = corsOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

const corsAllowCredentials = true;
if (corsAllowCredentials && allowedOrigins.includes('*')) {
    // Credentialed requests can't use "*" — set CORS_ORIGINS in .env for
    // your deployment. These are dev-only fallbacks.
    allowedOrigins = ['http://localhost:5173', 'http://localhost:5174'];
}

app.use(
    helmet({
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        contentSecurityPolicy: {
            directives: {
                ...helmet.contentSecurityPolicy.getDefaultDirectives(),
                'frame-ancestors': ["'self'", ...allowedOrigins],
            },
        },
    }),
);

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) {
            return callback(null, true);
        }
        if (allowedOrigins.includes('*')) {
            return callback(null, true);
        }
        if (allowedOrigins.indexOf(origin) !== -1) {
            return callback(null, true);
        }
        return callback(
            new Error('CORS policy does not allow access from the specified Origin.'),
            false,
        );
    },
    credentials: corsAllowCredentials,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'x-anonymous-id',
        'X-Map-Api-Key',
    ],
    exposedHeaders: [
        'Content-Range',
        'X-Content-Range',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Retry-After',
    ],
    maxAge: 86400,
};

app.use(cors(corsOptions));
app.use(passport.initialize());
app.use(cookieParser());
app.use(localeMiddleware);

const bodyLimit = process.env.REQUEST_BODY_LIMIT || '2mb';
app.use(express.json({ limit: bodyLimit }));
app.use(
    express.urlencoded({
        extended: true,
        limit: bodyLimit,
        parameterLimit: 1000,
    }),
);
app.use('/uploads', express.static('public/uploads'));
app.use(
    compression({
        filter: (req, res) => {
            if (
                req.headers['accept'] === 'text/event-stream' ||
                res.getHeader('Content-Type') === 'text/event-stream'
            ) {
                return false;
            }
            return compression.filter(req, res);
        },
    }),
);

if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
} else {
    app.use(morgan('combined'));
}

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 1000,
    message: {
        success: false,
        message: 'Too many requests, please try again after 15 minutes.',
        errors: ['TOO_MANY_REQUESTS'],
    },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/', limiter);

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use('/api/v1', routes);

app.get('/', (req, res) => {
    res.json({
        status: 'success',
        message: t('root_welcome', req.lang),
        version: '1.0.0',
        timestamp: new Date().toISOString(),
    });
});

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
