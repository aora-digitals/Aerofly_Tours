import "dotenv/config";
import express from "express";
import { createServer } from "http";
import crypto from "node:crypto";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { handleStripeWebhook } from "../stripe";
import { randomUUID } from "node:crypto";

async function startServer() {
  const app = express();
  
  const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, x-trpc-source"
    );
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  if (req.method === "OPTIONS") {
    if (origin && !allowedOrigins.has(origin)) {
      return res.status(403).end();
    }

    return res.status(204).end();
  }

  next();
});
  const server = createServer(app);

server.headersTimeout = 65_000;
server.requestTimeout = 120_000;
server.keepAliveTimeout = 5_000;

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");

app.use((req, res, next) => {
  const incomingRequestId = req.header("x-request-id");

  const requestId =
    incomingRequestId &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(incomingRequestId)
      ? incomingRequestId
      : crypto.randomUUID();

  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Referrer-Policy",
    "strict-origin-when-cross-origin",
  );
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self)",
  );
  res.setHeader(
    "Cross-Origin-Opener-Policy",
    "same-origin-allow-popups",
  );

  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  const csp = process.env.CONTENT_SECURITY_POLICY;

  if (
    csp &&
    csp.length <= 8192 &&
    !/[\r\n]/.test(csp)
  ) {
    res.setHeader("Content-Security-Policy", csp);
  }

  // const startedAt = Date.now();

  res.on("finish", () => {
    if (req.path === "/healthz") return;

    // Never log query strings, request bodies, cookies,
    // authentication headers, or payment details.
    
    // console.info(
    //   JSON.stringify({
    //     level: "info",
    //     event: "http_request",
    //     requestId,
    //     method: req.method,
    //     path: req.path.startsWith("/manus-storage/")
    //       ? "/manus-storage/:key"
    //       : req.path.startsWith("/api/trpc/")
    //         ? req.path.split("/").slice(0, 3).join("/")
    //         : req.path,
    //     status: res.statusCode,
    //     durationMs: Date.now() - startedAt,
    //   }),
    // );
  });

  next();
});
 
app.disable("x-powered-by");

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;

app.get("/healthz", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ status: "ok" });
});

app.use((req, res, next) => {
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();

  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Referrer-Policy",
    "strict-origin-when-cross-origin",
  );
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self)",
  );

  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  res.on("finish", () => {
    const durationMs =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000;

   if (process.env.LOG_HTTP_REQUESTS === "true") {
  console.info(
    JSON.stringify({
      event: "http_request_complete",
      requestId,
      method: req.method,
      route: req.route?.path ?? req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    }),
  );
}
  });

  next();
});

  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    try {
      const result = await handleStripeWebhook(req.body as Buffer, req.headers["stripe-signature"] as string | undefined);
      return res.json(result);
    } catch (error) {
      console.error("[Stripe Webhook] Rejected event:", error);
      return res.status(400).json({ error: "Webhook verification or processing failed" });
    }
  });
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

 
const requestedPort = Number.parseInt(
  process.env.PORT || "3000",
  10,
);

if (
  !Number.isInteger(requestedPort) ||
  requestedPort < 1 ||
  requestedPort > 65535
) {
  throw new Error(
    "PORT must be a valid TCP port between 1 and 65535",
  );
}

const port = requestedPort;

server.listen(port, "0.0.0.0", () => {
  console.info(
    JSON.stringify({
      level: "info",
      event: "server_started",
      port,
      environment: process.env.NODE_ENV || "development",
    }),
  );
});

const shutdown = (signal: string) => {
  console.info(
    JSON.stringify({
      level: "info",
      event: "server_shutdown_started",
      signal,
    }),
  );

  server.close((error) => {
    if (error) {
      console.error("Graceful shutdown failed", error.message);
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
  });

  setTimeout(() => {
    server.closeAllConnections();
  }, 10_000).unref();
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch((error) => {
  console.error("Server startup failed", error);
  process.exitCode = 1;
});
