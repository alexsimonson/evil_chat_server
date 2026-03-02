import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth } from "../middleware/auth";
import {
  buildDirectMessageAad,
  decryptMessageContent,
  encryptMessageContent,
} from "../utils/messageCrypto";

function normalizePair(userA: string, userB: string): { user1Id: string; user2Id: string } {
  return userA < userB
    ? { user1Id: userA, user2Id: userB }
    : { user1Id: userB, user2Id: userA };
}

async function usersShareServer(knex: Knex, userA: string, userB: string): Promise<boolean> {
  const row = await knex("server_memberships as m1")
    .join("server_memberships as m2", "m2.server_id", "m1.server_id")
    .select("m1.server_id")
    .where("m1.user_id", userA)
    .andWhere("m2.user_id", userB)
    .first();

  return Boolean(row);
}

async function requireConversationMember(
  knex: Knex,
  conversationId: number,
  userId: string
): Promise<any | null> {
  return knex("dm_conversations")
    .select("id", "user1_id as user1Id", "user2_id as user2Id")
    .where("id", conversationId)
    .andWhere((qb) => qb.where("user1_id", userId).orWhere("user2_id", userId))
    .first();
}

export function makeDMsRouter(knex: Knex) {
  const router = Router();

  router.get("/conversations", requireAuth, async (req, res) => {
    const userId = req.session.userId!;

    const conversations = await knex("dm_conversations")
      .select(
        "id",
        "user1_id as user1Id",
        "user2_id as user2Id",
        "created_at as createdAt",
        "updated_at as updatedAt"
      )
      .where("user1_id", userId)
      .orWhere("user2_id", userId)
      .orderBy("updated_at", "desc");

    const otherUserIds = conversations.map((c: any) =>
      c.user1Id === userId ? String(c.user2Id) : String(c.user1Id)
    );

    const users = otherUserIds.length
      ? await knex("users")
          .select("id", "username", "display_name as displayName")
          .whereIn("id", otherUserIds)
      : [];
    const userById = new Map(users.map((u: any) => [String(u.id), u]));

    const result = await Promise.all(
      conversations.map(async (c: any) => {
        const otherUserId = c.user1Id === userId ? String(c.user2Id) : String(c.user1Id);
        const otherUser = userById.get(otherUserId);

        const last = await knex("dm_messages")
          .select(
            "id",
            "user_id as userId",
            "content",
            "content_ciphertext as contentCiphertext",
            "content_nonce as contentNonce",
            "content_auth_tag as contentAuthTag",
            "content_alg as contentAlg",
            "content_key_id as contentKeyId",
            "created_at as createdAt"
          )
          .where("conversation_id", c.id)
          .orderBy("id", "desc")
          .first();

        let preview: string | null = null;
        let lastMessageAt: string | null = null;

        if (last) {
          preview = last.content ?? null;
          if (
            !preview &&
            last.contentCiphertext &&
            last.contentNonce &&
            last.contentAuthTag &&
            last.contentAlg &&
            last.contentKeyId
          ) {
            try {
              preview = decryptMessageContent(
                {
                  contentCiphertext: last.contentCiphertext,
                  contentNonce: last.contentNonce,
                  contentAuthTag: last.contentAuthTag,
                  contentAlg: last.contentAlg,
                  contentKeyId: last.contentKeyId,
                },
                buildDirectMessageAad(Number(c.id), String(last.userId))
              );
            } catch (e) {
              console.error("[dms] Failed to decrypt last message", {
                conversationId: c.id,
                messageId: last.id,
                error: e,
              });
              preview = "[Encrypted message unavailable]";
            }
          }

          lastMessageAt = last.createdAt;
        }

        return {
          id: c.id,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          otherUser: otherUser
            ? {
                id: String(otherUser.id),
                username: otherUser.username,
                displayName: otherUser.displayName ?? null,
              }
            : {
                id: otherUserId,
                username: "unknown-user",
                displayName: null,
              },
          lastMessagePreview: preview,
          lastMessageAt,
        };
      })
    );

    return res.json({ conversations: result });
  });

  router.post("/conversations", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const recipientUserId = String(req.body?.recipientUserId ?? "").trim();

    if (!recipientUserId || recipientUserId === userId) {
      return res.status(400).json({ error: "BAD_REQUEST" });
    }

    const recipient = await knex("users")
      .select("id", "username", "display_name as displayName")
      .where("id", recipientUserId)
      .first();

    if (!recipient) {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    const canMessage = await usersShareServer(knex, userId, recipientUserId);
    if (!canMessage) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const { user1Id, user2Id } = normalizePair(userId, recipientUserId);

    let conversation = await knex("dm_conversations")
      .select(
        "id",
        "user1_id as user1Id",
        "user2_id as user2Id",
        "created_at as createdAt",
        "updated_at as updatedAt"
      )
      .where("user1_id", user1Id)
      .andWhere("user2_id", user2Id)
      .first();

    if (!conversation) {
      [conversation] = await knex("dm_conversations")
        .insert({ user1_id: user1Id, user2_id: user2Id })
        .returning([
          "id",
          "user1_id as user1Id",
          "user2_id as user2Id",
          "created_at as createdAt",
          "updated_at as updatedAt",
        ]);
    }

    return res.json({
      conversation: {
        id: conversation.id,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        otherUser: {
          id: String(recipient.id),
          username: recipient.username,
          displayName: recipient.displayName ?? null,
        },
        lastMessagePreview: null,
        lastMessageAt: null,
      },
    });
  });

  router.get("/conversations/:conversationId/messages", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const conversationId = Number(req.params.conversationId);

    const limitRaw = req.query.limit;
    const beforeRaw = req.query.before;

    const limit = Math.min(
      100,
      Math.max(1, Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 50)
    );
    const before = Number.isFinite(Number(beforeRaw)) ? Number(beforeRaw) : null;

    if (!Number.isFinite(conversationId)) {
      return res.status(400).json({ error: "BAD_REQUEST" });
    }

    const membership = await requireConversationMember(knex, conversationId, userId);
    if (!membership) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    let q = knex("dm_messages")
      .join("users", "users.id", "dm_messages.user_id")
      .select(
        "dm_messages.id",
        "dm_messages.conversation_id as conversationId",
        "dm_messages.content",
        "dm_messages.content_ciphertext as contentCiphertext",
        "dm_messages.content_nonce as contentNonce",
        "dm_messages.content_auth_tag as contentAuthTag",
        "dm_messages.content_alg as contentAlg",
        "dm_messages.content_key_id as contentKeyId",
        "dm_messages.created_at as createdAt",
        "dm_messages.edited_at as editedAt",
        "users.id as userId",
        "users.username as username",
        "users.display_name as displayName"
      )
      .where("dm_messages.conversation_id", conversationId)
      .orderBy("dm_messages.id", "desc")
      .limit(limit);

    if (before !== null) q = q.andWhere("dm_messages.id", "<", before);

    const rows = await q;

    const messages = rows.map((r: any) => {
      let content = r.content ?? "";

      if (
        r.contentCiphertext &&
        r.contentNonce &&
        r.contentAuthTag &&
        r.contentAlg &&
        r.contentKeyId
      ) {
        try {
          content = decryptMessageContent(
            {
              contentCiphertext: r.contentCiphertext,
              contentNonce: r.contentNonce,
              contentAuthTag: r.contentAuthTag,
              contentAlg: r.contentAlg,
              contentKeyId: r.contentKeyId,
            },
            buildDirectMessageAad(r.conversationId, String(r.userId))
          );
        } catch (e) {
          console.error("[dms] Failed to decrypt message", { messageId: r.id, error: e });
          content = "[Encrypted message unavailable]";
        }
      }

      return {
        id: r.id,
        channelId: null,
        conversationId: r.conversationId,
        content,
        createdAt: r.createdAt,
        editedAt: r.editedAt ?? null,
        user: {
          id: String(r.userId),
          username: r.username,
          displayName: r.displayName ?? null,
        },
      };
    });

    const nextCursor = messages.length > 0 ? messages[messages.length - 1].id : null;

    return res.json({ messages, nextCursor });
  });

  router.post("/conversations/:conversationId/messages", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const conversationId = Number(req.params.conversationId);
    const { content } = req.body ?? {};

    if (!Number.isFinite(conversationId)) {
      return res.status(400).json({ error: "BAD_REQUEST" });
    }

    if (typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "BAD_REQUEST" });
    }

    const membership = await requireConversationMember(knex, conversationId, userId);
    if (!membership) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const trimmed = content.trim();
    const aad = buildDirectMessageAad(conversationId, userId);
    const encrypted = encryptMessageContent(trimmed, aad);

    const [row] = await knex("dm_messages")
      .insert({
        conversation_id: conversationId,
        user_id: userId,
        content: null,
        content_ciphertext: encrypted.contentCiphertext,
        content_nonce: encrypted.contentNonce,
        content_auth_tag: encrypted.contentAuthTag,
        content_alg: encrypted.contentAlg,
        content_key_id: encrypted.contentKeyId,
      })
      .returning(["id"]);

    await knex("dm_conversations")
      .where("id", conversationId)
      .update({ updated_at: knex.fn.now() });

    return res.json({ messageId: row.id });
  });

  return router;
}
