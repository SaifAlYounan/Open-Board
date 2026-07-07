import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { readLimiter } from "./lib/rateLimiters";

/**
 * Resolves the allowed origin(s) for CORS.
 *
 * Priority:
 *   1. ALLOWED_ORIGIN env var — explicit list, comma-separated
 *   2. Any *.replit.dev or *.replit.app origin (Replit-hosted only)
 *   3. localhost (development)
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
    // Anyone can host on *.replit.dev/app, so a shared-suffix wildcard with
    // credentials is not acceptable in production — require an explicit list.
    throw new Error("ALLOWED_ORIGIN environment variable is required in production (comma-separated origin allowlist).");
  }
  return (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    if (
      !origin ||
      /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
      /\.replit\.dev$/.test(origin) ||
      /\.replit\.app$/.test(origin)
    ) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin not allowed — ${origin}`));
  };
}

const originValidator = makeOriginValidator();

const app: Express = express();

// Trust exactly one proxy hop — Replit's reverse proxy in production.
// Assumption: the app always sits directly behind a single load-balancer/proxy.
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
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export { originValidator };
export default app;
