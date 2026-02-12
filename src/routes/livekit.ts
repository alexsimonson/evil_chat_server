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

    const apiKey = process.env.LIVEKIT_API_KEY ?? "devkey";
    const apiSecret = process.env.LIVEKIT_API_SECRET ?? "secret";
    const livekitUrl = process.env.LIVEKIT_URL ?? "ws://localhost:7880";

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

    return res.json({ token, url: livekitUrl, room: channel.livekitRoomName });
  });

  return router;
}
