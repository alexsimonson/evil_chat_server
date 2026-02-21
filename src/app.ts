import "dotenv/config";
import express from "express";
import session from "express-session";
import { knex } from "./db/knex";

import { makeAuthRouter } from "./routes/auth";
import { makeServersRouter } from "./routes/servers";
import { makeChannelsRouter } from "./routes/channels";
import { makeLiveKitRouter } from "./routes/livekit";

import cors from "cors";
// CORS configuration similar to abc_site (allows localhost and local network during development)
function getCorsOptions() {
  const isDevelopment = process.env.NODE_ENV !== "production";
  console.log('isDevelopment', isDevelopment);
  if (!isDevelopment) {
    return {
      origin: process.env.CORS_ORIGIN || "http://localhost:3002",
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    };
  }

  return {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) {
        console.log("[CORS] Allowing request with no origin header");
        return callback(null, true);
      }

      console.log(`[CORS] Checking origin: ${origin}`);

      if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
        console.log(`[CORS] ✓ Allowing localhost origin: ${origin}`);
        return callback(null, true);
      }

      try {
        const url = new URL(origin);
        const hostname = url.hostname;
        console.log(`[CORS] Parsed hostname: ${hostname}`);

        const isPrivate =
          /^127\./.test(hostname) ||
          /^192\.168\./.test(hostname) ||
          /^10\./.test(hostname) ||
          /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname) ||
          /\.local$/i.test(hostname) ||
          hostname === "localhost" ||
          hostname === "0.0.0.0";

        if (isPrivate) {
          console.log(`[CORS] ✓ Allowing private IP origin: ${origin}`);
          return callback(null, true);
        }
      } catch (e) {
        console.log(`[CORS] URL parsing error: ${e}`);
      }

      if (process.env.ALLOWED_ORIGINS) {
        const allowed = process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
        if (allowed.includes(origin)) {
          console.log(`[CORS] ✓ Allowing custom origin: ${origin}`);
          return callback(null, true);
        }
      }

      console.warn(`[CORS] ✗ REJECTED origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 200,
  };
}

export function makeApp() {
  const app = express();
  app.use(cors(getCorsOptions()));

  app.use(express.json());

  app.use(
    session({
      secret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false, // set true behind https
      },
    })
  );

  app.use("/auth", makeAuthRouter(knex));
  app.use("/servers", makeServersRouter(knex));
  app.use("/channels", makeChannelsRouter(knex));
  app.use("/livekit", makeLiveKitRouter(knex));

  return app;
}
