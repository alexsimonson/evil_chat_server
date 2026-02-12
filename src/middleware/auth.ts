import type { Request, Response, NextFunction } from "express";
import type { Knex } from "knex";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
  next();
}

export function makeRequireServerMember(knex: Knex) {
  return async function requireServerMember(req: Request, res: Response, next: NextFunction) {
    const userId = req.session?.userId;
    const serverId = Number(req.params.serverId);
    if (!userId || !Number.isFinite(serverId)) {
      return res.status(400).json({ error: "BAD_REQUEST" });
    }

    const row = await knex("server_memberships")
      .select("id")
      .where({ server_id: serverId, user_id: userId })
      .first();

    if (!row) return res.status(403).json({ error: "FORBIDDEN" });
    next();
  };
}

export function makeRequireChannelMember(knex: Knex) {
  return async function requireChannelMember(req: Request, res: Response, next: NextFunction) {
    const userId = req.session?.userId;
    const channelId = Number(req.params.channelId);
    if (!userId || !Number.isFinite(channelId)) {
      return res.status(400).json({ error: "BAD_REQUEST" });
    }

    // channels -> servers -> memberships
    const row = await knex("channels")
      .join("server_memberships", "server_memberships.server_id", "channels.server_id")
      .select("channels.id")
      .where("channels.id", channelId)
      .andWhere("server_memberships.user_id", userId)
      .first();

    if (!row) return res.status(403).json({ error: "FORBIDDEN" });
    next();
  };
}
