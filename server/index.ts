import 'dotenv/config';
import path from "path";
import express, { type Request, Response, NextFunction } from "express";
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import passport from 'passport';
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { pool } from './db';

declare global {
  namespace Express {
    interface User {
      id: number;
      email: string;
      fullName: string;
      roles: string[];
      apiKey?: string | null;
    }
  }
}

const app = express();
app.disable('x-powered-by');
// Trust proxy headers (X-Forwarded-Proto, X-Forwarded-Host) when behind ingress/load balancer
app.set('trust proxy', 1);

// Shared static assets (project-root /public/{images,...}) — mounted *first*
// so Vite's SPA catch-all in dev mode doesn't swallow them with an index.html
// response. `process.cwd()` is the project root under both `tsx server/...`
// and the esbuild-bundled prod entrypoint.
const projectPublicRoot = path.resolve(process.cwd(), 'public');
console.log(`[static] serving /public assets from ${projectPublicRoot}`);
app.use(express.static(projectPublicRoot));

// Skip body parsing for /mcp — the MCP transport reads the raw stream itself
app.use((req, res, next) => {
  if (req.path === '/mcp') return next();
  express.json()(req, res, next);
});
app.use((req, res, next) => {
  if (req.path === '/mcp') return next();
  express.urlencoded({ extended: false })(req, res, next);
});

import crypto from 'crypto';

const PgSession = connectPgSimple(session);
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[SECURITY] SESSION_SECRET not set — generated random secret. Sessions will not survive restarts. Set SESSION_SECRET in production.');
}
app.use(session({
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' },
}));
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const { configurePassport, configureAuthProviders, seedRoles, backfillApiKeys } = await import('./services/auth');
  configurePassport();
  await configureAuthProviders();
  await seedRoles();
  await backfillApiKeys();

  const server = await registerRoutes(app);

  const { registerMcpEndpoint } = await import('./mcp');
  registerMcpEndpoint(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Serve the app on port 3000
  const port = 3000;
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`serving on port ${port}`);
  });
})();
