// Load env early
import 'dotenv/config';

import morgan from 'morgan';
import path from 'path';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import express, { Request, Response, NextFunction } from 'express';
import logger from 'jet-logger';

import BaseRouter from '@src/routes';
import templatesRouter from '@src/routes/templates'; // <- Mailchimp templates API

import Paths from '@src/common/constants/Paths';
import ENV from '@src/common/constants/ENV';
import HttpStatusCodes from '@src/common/constants/HttpStatusCodes';
import { RouteError } from '@src/common/util/route-errors';
import { NodeEnvs } from '@src/common/constants';

import mailchimp from '@mailchimp/mailchimp_marketing';

/******************************************************************************
                                Setup
******************************************************************************/

const app = express();

/** ******** Middleware ******** **/

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Compression
app.use(compression());

// CORS (allow Angular dev origin by default)
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
  }),
);

// Show routes called in console during development
if (ENV.NodeEnv === NodeEnvs.Dev) {
  app.use(morgan('dev'));
}

// Security (enable Helmet in production unless explicitly disabled)
if (ENV.NodeEnv === NodeEnvs.Production) {
  if (!process.env.DISABLE_HELMET) {
    app.use(helmet());
  }
}

// --- Mailchimp SDK config (reads from .env) ---
mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY ?? '',
  server: process.env.MAILCHIMP_DC ?? '', // e.g., 'us21'
});

/** ******** Routes ******** **/

// Existing base router (whatever your template already exposes)
app.use(Paths.Base, BaseRouter);

// Mailchimp templates API
app.use('/api/templates', templatesRouter);

// Health check
app.get('/health', (_: Request, res: Response) => {
  res.json({ ok: true });
});

/** ******** Error handler ******** **/
app.use((err: Error, _: Request, res: Response, next: NextFunction) => {
  if (ENV.NodeEnv !== NodeEnvs.Test.valueOf()) {
    logger.err(err, true);
  }
  let status = HttpStatusCodes.BAD_REQUEST;
  if (err instanceof RouteError) {
    status = err.status;
    res.status(status).json({ error: err.message });
  }
  return next(err);
});

/** ******** Static/demo pages from template ******** **/

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
    // @ts-ignore: ping may be missing in types
    const pong = await (mailchimp as any).ping.get();
    res.json({ ok: true, pong });
  } catch (e: any) {
    const status = e?.status || e?.response?.status || 500;
    // eslint-disable-next-line no-console
    console.error('Mailchimp ping error:', status, e?.message || e?.response?.text);
    res.status(status).json({ ok: false, message: e?.message || e?.response?.text || 'Ping failed' });
  }
});

/******************************************************************************
                             Start HTTP server
******************************************************************************/

const port = Number(process.env.PORT ?? 3000);
app.set('port', port);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`✅ API listening on http://localhost:${port}`);
});

// (optional) crash hardening
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));

/******************************************************************************
                                Export default
******************************************************************************/

export default app;
