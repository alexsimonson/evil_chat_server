import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { makeApp } from "./app";
import { initializeSocketHandlers } from "./websocket/socketHandlers";

/* ---------------- startup ---------------- */
const PORT = Number(process.env.PORT ?? 3001);
const app = makeApp();

const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow same CORS origins as the Express app
      const isDevelopment = process.env.NODE_ENV !== "production";
      if (!isDevelopment) {
        const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3002";
        if (origin === corsOrigin) return callback(null, true);
        return callback(new Error("CORS rejected"));
      }

      if (!origin) return callback(null, true);
      if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
        return callback(null, true);
      }

      try {
        const url = new URL(origin);
        const hostname = url.hostname;
        const isPrivate =
          /^127\./.test(hostname) ||
          /^192\.168\./.test(hostname) ||
          /^10\./.test(hostname) ||
          /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname) ||
          /\.local$/i.test(hostname) ||
          hostname === "localhost";
        if (isPrivate) return callback(null, true);
      } catch (e) {
        console.log(`[Socket.IO CORS] URL parsing error: ${e}`);
      }

      if (process.env.ALLOWED_ORIGINS) {
        const allowed = process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
        if (allowed.includes(origin)) return callback(null, true);
      }

      callback(new Error("CORS rejected"));
    },
  },
  transports: ["websocket", "polling"],
});

// Add global error handler for socket.io
io.on("error", (error: any) => {
  console.error("[Socket.IO] Server error:", error);
});

// Initialize socket handlers (manages connections, messages, presence)
initializeSocketHandlers(io);

httpServer.listen(PORT, () => {
  console.log(`API running at http://localhost:${PORT}`);
  console.log(`WebSocket server ready`);
});
