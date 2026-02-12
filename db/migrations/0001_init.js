/**
 * 0001_init.js
 * Discord-lite MVP schema (text + voice mapping)
 *
 * Tables:
 *  - users
 *  - invites
 *  - servers
 *  - server_memberships
 *  - channels (text|voice)
 *  - messages
 *  - voice_sessions (optional analytics/audit)
 *
 * Notes:
 *  - Uses UUIDs for users/invites (no collision, easier client-side refs)
 *  - Uses BIGSERIAL for most relational entities (fast joins, simple ordering)
 *  - Channel "type" is constrained to text|voice
 *  - Voice channels have livekit_room_name (required for voice, optional for text)
 */

/**
 * @param {import("knex").Knex} knex
 */
exports.up = async function up(knex) {
  // UUID generation (pgcrypto provides gen_random_uuid())
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // USERS
  await knex.raw(`
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX users_created_at_idx ON users (created_at);
  `);

  // INVITES (invite-only signup)
  await knex.raw(`
    CREATE TABLE invites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL UNIQUE,
      created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      claimed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      claimed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      max_uses INTEGER NOT NULL DEFAULT 1,
      uses_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX invites_code_idx ON invites (code);
    CREATE INDEX invites_expires_at_idx ON invites (expires_at);
  `);

  // SERVERS
  await knex.raw(`
    CREATE TABLE servers (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX servers_owner_idx ON servers (owner_user_id);
  `);

  // MEMBERSHIPS (user-to-server relationship + role)
  await knex.raw(`
    CREATE TABLE server_memberships (
      id BIGSERIAL PRIMARY KEY,
      server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member', -- e.g. 'owner'|'admin'|'member'
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (server_id, user_id)
    );

    CREATE INDEX server_memberships_server_idx ON server_memberships (server_id);
    CREATE INDEX server_memberships_user_idx ON server_memberships (user_id);
  `);

  // CHANNELS (text or voice)
  await knex.raw(`
    CREATE TABLE channels (
      id BIGSERIAL PRIMARY KEY,
      server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL, -- 'text' | 'voice'
      sort_order INTEGER,
      -- For voice: each voice channel maps to a LiveKit room name
      livekit_room_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT channels_type_check CHECK (type IN ('text','voice'))
    );

    -- Ensure voice channels have a room name (text channels may leave it null)
    CREATE UNIQUE INDEX channels_voice_room_unique
      ON channels (server_id, livekit_room_name)
      WHERE livekit_room_name IS NOT NULL;

    CREATE INDEX channels_server_idx ON channels (server_id);
    CREATE INDEX channels_server_sort_idx ON channels (server_id, sort_order, id);
  `);

  // MESSAGES (persisted chat content)
  await knex.raw(`
    CREATE TABLE messages (
      id BIGSERIAL PRIMARY KEY,
      channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      edited_at TIMESTAMPTZ,

      CONSTRAINT messages_content_nonempty CHECK (length(trim(content)) > 0)
    );

    CREATE INDEX messages_channel_created_idx ON messages (channel_id, created_at DESC);
    CREATE INDEX messages_user_created_idx ON messages (user_id, created_at DESC);
  `);

  // VOICE SESSIONS (optional analytics/audit)
  await knex.raw(`
    CREATE TABLE voice_sessions (
      id BIGSERIAL PRIMARY KEY,
      channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      left_at TIMESTAMPTZ,
      -- Optional metadata (not required for MVP)
      client_metadata JSONB,

      CONSTRAINT voice_sessions_left_after_join CHECK (left_at IS NULL OR left_at >= joined_at)
    );

    CREATE INDEX voice_sessions_channel_joined_idx ON voice_sessions (channel_id, joined_at DESC);
    CREATE INDEX voice_sessions_user_joined_idx ON voice_sessions (user_id, joined_at DESC);
  `);
};

/**
 * @param {import("knex").Knex} knex
 */
exports.down = async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS voice_sessions;
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS channels;
    DROP TABLE IF EXISTS server_memberships;
    DROP TABLE IF EXISTS servers;
    DROP TABLE IF EXISTS invites;
    DROP TABLE IF EXISTS users;
  `);
};
