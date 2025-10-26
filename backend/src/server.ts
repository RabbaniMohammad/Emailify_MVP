// Load env early
import 'dotenv/config';

import mongoose from 'mongoose';
import morgan from 'morgan';
import path from 'path';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import logger from 'jet-logger';
import campaignRoutes from './routes/campaign.routes';

import connectDB from '@src/config/database';
import passport from '@src/config/passport';

import BaseRouter from '@src/routes';
import templatesRouter from '@src/routes/templates';
import qaRouter from '@src/routes/qa';
import authRouter  from '@src/routes/auth';
import adminRouter from '@src/routes/admin';
import templateGenerationRouter from '@src/routes/templateGeneration'; // ✅ NEW
import debugLogsRouter from '@src/routes/debug-logs'; // Debug logging endpoint

import Paths from '@src/common/constants/Paths';
import ENV from '@src/common/constants/ENV';
import HttpStatusCodes from '@src/common/constants/HttpStatusCodes';
import { RouteError } from '@src/common/util/route-errors';
import { NodeEnvs } from '@src/common/constants';

import mailchimp from '@mailchimp/mailchimp_marketing';

import qaNewRouter from '@src/routes/qa-new';

/******************************************************************************
                                Setup
******************************************************************************/

const app = express();

// Connect to MongoDB
connectDB();

/** ******** Middleware ******** **/

// Body parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '5mb' }));

// Cookie parser
app.use(cookieParser());

// Compression
app.use(compression());

// CORS
const allowed = (process.env.ALLOWED_ORIGINS || 'http://localhost:4200')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowed.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true, // Important for cookies
  }),
);

// Show routes called in console during development
if (ENV.NodeEnv === NodeEnvs.Dev) {
  app.use(morgan('dev'));
}

// Rate limiting - protect against abuse and overload
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.RATE_LIMIT_MAX_REQUESTS ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) : 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: 'Too many requests from this IP, please try again later.',
});

// Apply rate limiting to all API routes
app.use('/api/', limiter);

// Stricter rate limiting for AI generation endpoints (expensive operations)
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: process.env.AI_RATE_LIMIT_MAX_REQUESTS ? parseInt(process.env.AI_RATE_LIMIT_MAX_REQUESTS) : 20, // Configurable AI rate limit
  message: 'Too many AI generation requests, please try again later.',
});

app.use('/api/generate', aiLimiter);
app.use('/api/qa', aiLimiter);

// Security
if (ENV.NodeEnv === NodeEnvs.Production) {
  if (!process.env.DISABLE_HELMET) {
    app.use(helmet());
  }
}

// Initialize Passport
app.use(passport.initialize());

// Mailchimp SDK config
mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY ?? '',
  server: process.env.MAILCHIMP_DC ?? '',
});

/** ******** Routes ******** **/

// Auth routes (must be before other API routes)
app.use('/api/auth', authRouter);

// Debug logging endpoint
app.use('/api/debug-logs', debugLogsRouter);

// app.use('/api/qa-new', qaNewRouter);
// app.use('/api/qa', qaNewRouter);


// Admin Routes 
app.use('/api/admin', adminRouter);

// Template Generation Routes ✅ NEW
app.use('/api/generate', templateGenerationRouter);

// Core API routers
app.use('/api/templates', templatesRouter);
app.use('/api/qa', qaRouter);
// app.use('/api/qa', qaNewRouter);

// Existing base router
app.use(Paths.Base, BaseRouter);

// Health check
app.get('/health', (_: Request, res: Response) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.json({ ok: true, mongodb: mongoStatus });
});

/** ******** Error handler ******** **/
app.use((err: Error, _: Request, res: Response, next: NextFunction) => {
  if (ENV.NodeEnv !== NodeEnvs.Test.valueOf()) {
    logger.err(err, true);
  }
  let status = HttpStatusCodes.BAD_REQUEST;
  if (err instanceof RouteError) {
    status = err.status;
  }
  res.status(status).json({ error: err.message });
  return next(err);
});

/** ******** Static/demo pages ******** **/

const viewsDir = path.join(__dirname, 'views');
app.set('views', viewsDir);

const staticDir = path.join(__dirname, 'public');
app.use(express.static(staticDir));

app.get('/', (_: Request, res: Response) => res.redirect('/users'));
app.get('/users', (_: Request, res: Response) => {
  return res.sendFile('users.html', { root: viewsDir });
});

app.get('/api/ping', async (_req, res) => {
  try {
    const pong = await (mailchimp as any).ping.get();
    res.json({ ok: true, pong });
  } catch (e: any) {
    const status = e?.status || e?.response?.status || 500;
    console.error('Mailchimp ping error:', status, e?.message || e?.response?.text);
    res.status(status).json({ ok: false, message: e?.message || e?.response?.text || 'Ping failed' });
  }
});

app.use('/api', campaignRoutes);

/******************************************************************************
                             Start HTTP server
******************************************************************************/

const port = Number(process.env.PORT ?? 3000);
app.set('port', port);
app.listen(port, () => {
});

// Crash hardening
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));

export default app;


