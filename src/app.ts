import "dotenv/config";
import express from "express";
import session from "express-session";
import { knex } from "./db/knex";

import { makeAuthRouter } from "./routes/auth";
import { makeServersRouter } from "./routes/servers";
import { makeChannelsRouter } from "./routes/channels";
import { makeLiveKitRouter } from "./routes/livekit";

import cors from "cors";

export function makeApp() {
  const app = express();
  app.use(
    cors({
      origin: "http://localhost:5173", // your Vite dev URL
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
    })
  );

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
