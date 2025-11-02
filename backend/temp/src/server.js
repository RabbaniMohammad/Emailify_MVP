"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const mongoose_1 = __importDefault(require("mongoose"));
const morgan_1 = __importDefault(require("morgan"));
const path_1 = __importDefault(require("path"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const jet_logger_1 = __importDefault(require("jet-logger"));
const campaign_routes_1 = __importDefault(require("./routes/campaign.routes"));
const database_1 = __importDefault(require("@src/config/database"));
const passport_1 = __importDefault(require("@src/config/passport"));
const routes_1 = __importDefault(require("@src/routes"));
const templates_1 = __importDefault(require("@src/routes/templates"));
const qa_1 = __importDefault(require("@src/routes/qa"));
const auth_1 = __importDefault(require("@src/routes/auth"));
const admin_1 = __importDefault(require("@src/routes/admin"));
const templateGeneration_1 = __importDefault(require("@src/routes/templateGeneration"));
const debug_logs_1 = __importDefault(require("@src/routes/debug-logs"));
const Paths_1 = __importDefault(require("@src/common/constants/Paths"));
const ENV_1 = __importDefault(require("@src/common/constants/ENV"));
const HttpStatusCodes_1 = __importDefault(require("@src/common/constants/HttpStatusCodes"));
const route_errors_1 = require("@src/common/util/route-errors");
const constants_1 = require("@src/common/constants");
const mailchimp_marketing_1 = __importDefault(require("@mailchimp/mailchimp_marketing"));
const app = (0, express_1.default)();
(0, database_1.default)();
app.use(express_1.default.urlencoded({ extended: true }));
app.use(express_1.default.json({ limit: '5mb' }));
app.use((0, cookie_parser_1.default)());
app.use((0, compression_1.default)());
const allowed = (process.env.ALLOWED_ORIGINS || 'http://localhost:4200')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
app.use((0, cors_1.default)({
    origin: (origin, cb) => {
        if (!origin || allowed.includes(origin))
            return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));
if (ENV_1.default.NodeEnv === constants_1.NodeEnvs.Dev) {
    app.use((0, morgan_1.default)('dev'));
}
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: process.env.RATE_LIMIT_MAX_REQUESTS ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) : Number.MAX_SAFE_INTEGER,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests from this IP, please try again later.',
    skip: () => process.env.NODE_ENV === 'development',
});
app.use('/api/', limiter);
const aiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    max: process.env.AI_RATE_LIMIT_MAX_REQUESTS ? parseInt(process.env.AI_RATE_LIMIT_MAX_REQUESTS) : 100,
    message: 'Too many AI generation requests, please try again later.',
    skip: () => process.env.NODE_ENV === 'development',
});
app.use('/api/generate', aiLimiter);
app.use('/api/qa', aiLimiter);
if (ENV_1.default.NodeEnv === constants_1.NodeEnvs.Production) {
    if (!process.env.DISABLE_HELMET) {
        app.use((0, helmet_1.default)());
    }
}
app.use(passport_1.default.initialize());
mailchimp_marketing_1.default.setConfig({
    apiKey: process.env.MAILCHIMP_API_KEY ?? '',
    server: process.env.MAILCHIMP_DC ?? '',
});
app.use('/api/auth', auth_1.default);
app.use('/api/debug-logs', debug_logs_1.default);
app.use('/api/admin', admin_1.default);
app.use('/api/generate', (req, res, next) => {
    next();
}, templateGeneration_1.default);
app.use('/api/templates', templates_1.default);
app.use('/api/qa', qa_1.default);
app.use(Paths_1.default.Base, routes_1.default);
app.get('/health', (_, res) => {
    const mongoStatus = mongoose_1.default.connection.readyState === 1 ? 'connected' : 'disconnected';
    res.json({ ok: true, mongodb: mongoStatus });
});
app.use((err, _, res, next) => {
    if (ENV_1.default.NodeEnv !== constants_1.NodeEnvs.Test.valueOf()) {
        jet_logger_1.default.err(err, true);
    }
    let status = HttpStatusCodes_1.default.BAD_REQUEST;
    if (err instanceof route_errors_1.RouteError) {
        status = err.status;
    }
    res.status(status).json({ error: err.message });
    return next(err);
});
const viewsDir = path_1.default.join(__dirname, 'views');
app.set('views', viewsDir);
const staticDir = path_1.default.join(__dirname, 'public');
app.use(express_1.default.static(staticDir));
app.get('/', (_, res) => res.redirect('/users'));
app.get('/users', (_, res) => {
    return res.sendFile('users.html', { root: viewsDir });
});
app.get('/api/ping', async (_req, res) => {
    try {
        const pong = await mailchimp_marketing_1.default.ping.get();
        res.json({ ok: true, pong });
    }
    catch (e) {
        const status = e?.status || e?.response?.status || 500;
        console.error('Mailchimp ping error:', status, e?.message || e?.response?.text);
        res.status(status).json({ ok: false, message: e?.message || e?.response?.text || 'Ping failed' });
    }
});
app.use('/api', campaign_routes_1.default);
const port = Number(process.env.PORT ?? 3000);
app.set('port', port);
app.listen(port, () => {
});
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
exports.default = app;
