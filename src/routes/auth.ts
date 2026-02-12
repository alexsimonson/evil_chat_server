import { Router } from "express";
import type { Knex } from "knex";
import bcrypt from "bcryptjs";
import { requireAuth } from "../middleware/auth";

function userDto(u: any) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    displayName: u.display_name ?? null,
  };
}

export function makeAuthRouter(knex: Knex) {
  const router = Router();

  // POST /auth/login
  router.post("/login", async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "BAD_REQUEST" });
    }

    const user = await knex("users")
      .select("id", "email", "username", "display_name", "password_hash")
      .where({ email })
      .first();

    if (!user) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

    req.session.userId = user.id;
    return res.json({ user: userDto(user) });
  });

  // POST /auth/logout
  router.post("/logout", requireAuth, async (req, res) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: "LOGOUT_FAILED" });
      res.status(204).send();
    });
  });

  // GET /me
  router.get("/me", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const user = await knex("users")
      .select("id", "email", "username", "display_name")
      .where({ id: userId })
      .first();

    if (!user) return res.status(401).json({ error: "UNAUTHENTICATED" });
    return res.json({ user: userDto(user) });
  });

  return router;
}
