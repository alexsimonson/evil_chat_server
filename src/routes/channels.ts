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


  return router;
}
