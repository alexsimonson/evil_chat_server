import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, makeRequireChannelMember } from "../middleware/auth";

export function makeChannelsRouter(knex: Knex) {
  const router = Router();
  const requireChannelMember = makeRequireChannelMember(knex);

  // GET /channels/:channelId/messages?limit=50&before=123
  router.get("/:channelId/messages", requireAuth, requireChannelMember, async (req, res) => {
    const channelId = Number(req.params.channelId);

    const limitRaw = req.query.limit;
    const beforeRaw = req.query.before;

    const limit = Math.min(
      100,
      Math.max(1, Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 50)
    );
    const before = Number.isFinite(Number(beforeRaw)) ? Number(beforeRaw) : null;

    let q = knex("messages")
      .join("users", "users.id", "messages.user_id")
      .select(
        "messages.id",
        "messages.channel_id as channelId",
        "messages.content",
        "messages.created_at as createdAt",
        "messages.edited_at as editedAt",
        "users.id as userId",
        "users.username as username",
        "users.display_name as displayName"
      )
      .where("messages.channel_id", channelId)
      .orderBy("messages.id", "desc")
      .limit(limit);

    if (before !== null) q = q.andWhere("messages.id", "<", before);

    const rows = await q;

    const messages = rows.map((r: any) => ({
      id: r.id,
      channelId: r.channelId,
      content: r.content,
      createdAt: r.createdAt,
      editedAt: r.editedAt ?? null,
      user: {
        id: r.userId,
        username: r.username,
        displayName: r.displayName ?? null,
      },
    }));

    const nextCursor = messages.length > 0 ? messages[messages.length - 1].id : null;

    return res.json({ messages, nextCursor });
  });
  
  // POST /channels/:channelId/messages
  router.post("/:channelId/messages", requireAuth, requireChannelMember, async (req, res) => {
    const channelId = Number(req.params.channelId);
    const userId = req.session.userId!;
    const { content } = req.body ?? {};

    if (!Number.isFinite(channelId)) {
      return res.status(400).json({ error: "BAD_REQUEST" });
    }

    if (typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "BAD_REQUEST" });
    }

    const trimmed = content.trim();

    const [row] = await knex("messages")
      .insert({
        channel_id: channelId,
        user_id: userId,
        content: trimmed,
      })
      .returning(["id"]);

    return res.json({ messageId: row.id });
  });

  // GET /channels/voice/participants/:serverId - Get voice channels and their participants for a server
  router.get("/voice/participants/:serverId", requireAuth, async (req, res) => {
    const serverId = Number(req.params.serverId);
    const userId = req.session.userId!;

    if (!Number.isFinite(serverId)) {
      return res.status(400).json({ error: "BAD_REQUEST" });
    }

    // Verify user is a member of the server
    const membership = await knex("server_memberships")
      .where("server_id", serverId)
      .andWhere("user_id", userId)
      .first();

    if (!membership) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    // Get all voice channels for the server with their current participants
    const channels = await knex("channels")
      .select("id", "name", "livekit_room_name as livekitRoomName")
      .where("server_id", serverId)
      .andWhere("type", "voice")
      .orderBy("sort_order", "asc")
      .orderBy("id", "asc");

    // For each voice channel, get active participants (where left_at is NULL)
    const channelData = await Promise.all(
      channels.map(async (channel) => {
        const participants = await knex("voice_sessions")
          .join("users", "users.id", "voice_sessions.user_id")
          .select(
            "users.id as userId",
            "users.username",
            "users.display_name as displayName"
          )
          .where("voice_sessions.channel_id", channel.id)
          .whereNull("voice_sessions.left_at");

        return {
          id: channel.id,
          name: channel.name,
          livekitRoomName: channel.livekitRoomName,
          participants: participants.map((p: any) => ({
            id: p.userId,
            username: p.username,
            displayName: p.displayName ?? null,
          })),
        };
      })
    );

    return res.json({ channels: channelData });
  });

  return router;
}
