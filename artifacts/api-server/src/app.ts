import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { readLimiter } from "./lib/rateLimiters";

/**
 * Resolves the allowed origin(s) for CORS.
 *
 * Priority:
 *   1. ALLOWED_ORIGIN env var — explicit list, comma-separated (required in production)
 *   2. localhost (development only)
 *
 * External sites are rejected.
 */
function makeOriginValidator() {
  if (process.env.ALLOWED_ORIGIN) {
    const explicit = process.env.ALLOWED_ORIGIN.split(",").map((s) => s.trim());
    return (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || explicit.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin not allowed — ${origin}`));
    };
  }
  if (process.env.NODE_ENV === "production") {
    // In production an explicit origin allowlist is mandatory — no wildcard fallback.
    throw new Error("ALLOWED_ORIGIN environment variable is required in production (comma-separated origin allowlist).");
  }
  // Development default: localhost only.
  return (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin not allowed — ${origin}`));
  };
}

const originValidator = makeOriginValidator();

const app: Express = express();

// Trust exactly one proxy hop — the app is assumed to sit directly behind a
// single reverse proxy / load balancer (nginx, Cloudflare, an ALB, etc.).
// If the deployment topology changes (e.g., multi-hop CDN), update this value.
// Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// and falls back to incorrect IP identification for all clients.
app.set("trust proxy", 1);

app.use(helmet());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({
  origin: originValidator,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use("/api", readLimiter);
app.use("/api", router);

// Optionally serve the built frontend from the API (single-image deployment).
// When STATIC_DIR points at the SPA build, the API serves its assets and returns
// index.html for client-side routes, so `docker compose up` needs no separate
// static host. Unset in dev — the Vite dev server serves the SPA and proxies /api.
const staticDir = process.env.STATIC_DIR;
if (staticDir && fs.existsSync(path.join(staticDir, "index.html"))) {
  // Read index.html once at startup. We serve it with res.send (not res.sendFile)
  // so it keeps the Content-Security-Policy that helmet set — Express's file
  // sender otherwise downgrades the CSP to `default-src 'none'`, which would block
  // the SPA's own scripts/styles.
  const indexHtml = fs.readFileSync(path.join(staticDir, "index.html"), "utf8");
  app.use(express.static(staticDir, { index: false }));
  // SPA fallback: a GET that isn't an /api or /socket.io request and doesn't map
  // to a static file returns index.html, so client-side routing works on deep
  // links and refreshes. Express 5 rejects the "*" route pattern, hence a guard.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) return next();
    res.type("html").send(indexHtml);
  });
  logger.info({ staticDir }, "Serving frontend static build");
}

// Any unmatched /api request returns JSON 404 — never Express's default HTML,
// which breaks clients that call res.json() on the response (e.g. the admin
// "Reset All Data" action when that route is absent outside DEMO_MODE). Mounted
// after all /api routers, before the error handler.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.message?.startsWith("CORS:")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (
    err?.type === "entity.too.large" ||
    err?.status === 413 ||
    err?.statusCode === 413
  ) {
    res.status(413).json({ error: "Request body too large. Maximum size is 1MB." });
    return;
  }
  // A syntactically-invalid JSON body makes express.json throw a SyntaxError
  // (type "entity.parse.failed", status 400) before any route runs. That is a
  // client error, not a server fault — return 400 in the API's { error } shape
  // instead of letting it fall through to the generic 500.
  const bodyErr = err as { type?: string; status?: number; statusCode?: number } | undefined;
  if (
    bodyErr?.type === "entity.parse.failed" ||
    (err instanceof SyntaxError && (bodyErr?.status === 400 || bodyErr?.statusCode === 400))
  ) {
    res.status(400).json({ error: "Malformed JSON in request body." });
    return;
  }
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export { originValidator };
export default app;
