/**
 * @param {import("knex").Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE dm_conversations (
      id BIGSERIAL PRIMARY KEY,
      user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      CONSTRAINT dm_conversations_users_distinct CHECK (user1_id <> user2_id)
    );

    CREATE UNIQUE INDEX dm_conversations_pair_unique
      ON dm_conversations ((LEAST(user1_id::text, user2_id::text)), (GREATEST(user1_id::text, user2_id::text)));

    CREATE INDEX dm_conversations_user1_idx ON dm_conversations (user1_id);
    CREATE INDEX dm_conversations_user2_idx ON dm_conversations (user2_id);

    CREATE TABLE dm_messages (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      content TEXT,
      content_ciphertext TEXT,
      content_nonce TEXT,
      content_auth_tag TEXT,
      content_alg TEXT,
      content_key_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      edited_at TIMESTAMPTZ,

      CONSTRAINT dm_messages_content_or_ciphertext_present
      CHECK (
        (
          content IS NOT NULL
          AND length(trim(content)) > 0
        )
        OR
        (
          content_ciphertext IS NOT NULL
          AND content_nonce IS NOT NULL
          AND content_auth_tag IS NOT NULL
          AND content_alg IS NOT NULL
          AND content_key_id IS NOT NULL
        )
      )
    );

    CREATE INDEX dm_messages_conversation_created_idx
      ON dm_messages (conversation_id, created_at DESC);
    CREATE INDEX dm_messages_user_created_idx
      ON dm_messages (user_id, created_at DESC);
  `);
};

/**
 * @param {import("knex").Knex} knex
 */
exports.down = async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS dm_messages;
    DROP TABLE IF EXISTS dm_conversations;
  `);
};
