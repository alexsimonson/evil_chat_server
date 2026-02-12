import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, makeRequireServerMember } from "../middleware/auth";

export function makeServersRouter(knex: Knex) {
  const router = Router();
  const requireServerMember = makeRequireServerMember(knex);

  // GET /servers  (servers I'm in)
  router.get("/", requireAuth, async (req, res) => {
    const userId = req.session.userId!;

    const servers = await knex("servers")
      .join("server_memberships", "server_memberships.server_id", "servers.id")
      .select(
        "servers.id",
        "servers.name",
        "servers.owner_user_id as ownerUserId",
        "servers.created_at as createdAt"
      )
      .where("server_memberships.user_id", userId)
      .orderBy("servers.id", "asc");

    return res.json({ servers });
  });

  // GET /servers/:serverId/channels
  router.get("/:serverId/channels", requireAuth, requireServerMember, async (req, res) => {
    const serverId = Number(req.params.serverId);

    const channels = await knex("channels")
      .select(
        "id",
        "server_id as serverId",
        "name",
        "type",
        "sort_order as sortOrder",
        "livekit_room_name as livekitRoomName",
        "created_at as createdAt"
      )
      .where({ server_id: serverId })
      .orderBy([{ column: "sort_order", order: "asc" }, { column: "id", order: "asc" }]);

    return res.json({ channels });
  });

  return router;
}
