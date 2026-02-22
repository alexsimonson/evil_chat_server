import { Router } from "express";
import type { Knex } from "knex";
import { AccessToken } from "livekit-server-sdk";
import { requireAuth } from "../middleware/auth";

export function makeLiveKitRouter(knex: Knex) {
  const router = Router();

  router.post("/token", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const { channelId } = req.body ?? {};

    const cid = Number(channelId);
    if (!Number.isFinite(cid)) {
      return res.status(400).json({ error: "BAD_REQUEST" });
    }

    // Must be a voice channel AND user must be a member of the server that owns it
    const channel = await knex("channels")
      .join("server_memberships", "server_memberships.server_id", "channels.server_id")
      .select(
        "channels.id",
        "channels.type",
        "channels.livekit_room_name as livekitRoomName"
      )
      .where("channels.id", cid)
      .andWhere("channels.type", "voice")
      .andWhere("server_memberships.user_id", userId)
      .first();

    if (!channel) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    if (!channel.livekitRoomName) {
      return res.status(500).json({ error: "VOICE_ROOM_NOT_CONFIGURED" });
    }

    const apiKey = process.env.VITE_LIVEKIT_API_KEY ?? "devkey";
    const apiSecret = process.env.VITE_LIVEKIT_API_SECRET ?? "secret";
    // Prefer explicit env var; otherwise derive a host-based default so LAN devices
    // can connect to the LiveKit server running on the same machine.
    const reqHost = (req.headers.host || req.hostname || "localhost").split(":")[0];
    const livekitUrl = process.env.VITE_LIVEKIT_URL ?? `wss://${reqHost}:8443`;

    const at = new AccessToken(apiKey, apiSecret, {
      identity: userId, // can also use username if you want
    });

    at.addGrant({
      roomJoin: true,
      room: channel.livekitRoomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();

    // Build ICE servers list: prefer explicit env var JSON, otherwise use TURN env vars,
    // and always include a public STUN as fallback.
    let iceServers: any[] = [{ urls: "stun:stun.l.google.com:19302" }];

    if (process.env.VITE_LIVEKIT_ICE_SERVERS) {
      try {
        const parsed = JSON.parse(process.env.VITE_LIVEKIT_ICE_SERVERS);
        if (Array.isArray(parsed)) iceServers = parsed;
      } catch (e) {
        console.warn("VITE_LIVEKIT_ICE_SERVERS parse error", e);
      }
    } else if (process.env.LIVEKIT_TURN_URL) {
      const turnUrl = process.env.LIVEKIT_TURN_URL; // e.g. turn:turn.example.com:3478
      const username = process.env.LIVEKIT_TURN_USER;
      const credential = process.env.LIVEKIT_TURN_PASS;
      const turnEntry: any = { urls: turnUrl };
      if (username) turnEntry.username = username;
      if (credential) turnEntry.credential = credential;
      iceServers = [turnEntry, ...iceServers];
    }

    return res.json({ token, url: livekitUrl, room: channel.livekitRoomName, iceServers });
  });

  return router;
}
