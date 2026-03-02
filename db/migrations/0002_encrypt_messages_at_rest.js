/**
 * @param {import("knex").Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE messages
      DROP CONSTRAINT IF EXISTS messages_content_nonempty;

    ALTER TABLE messages
      ALTER COLUMN content DROP NOT NULL;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS content_ciphertext TEXT,
      ADD COLUMN IF NOT EXISTS content_nonce TEXT,
      ADD COLUMN IF NOT EXISTS content_auth_tag TEXT,
      ADD COLUMN IF NOT EXISTS content_alg TEXT,
      ADD COLUMN IF NOT EXISTS content_key_id TEXT;

    ALTER TABLE messages
      ADD CONSTRAINT messages_content_or_ciphertext_present
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
      );
  `);
};

/**
 * @param {import("knex").Knex} knex
 */
exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE messages
      DROP CONSTRAINT IF EXISTS messages_content_or_ciphertext_present;

    UPDATE messages
      SET content = '[Encrypted message unavailable]'
      WHERE content IS NULL OR length(trim(content)) = 0;

    ALTER TABLE messages
      DROP COLUMN IF EXISTS content_ciphertext,
      DROP COLUMN IF EXISTS content_nonce,
      DROP COLUMN IF EXISTS content_auth_tag,
      DROP COLUMN IF EXISTS content_alg,
      DROP COLUMN IF EXISTS content_key_id;

    ALTER TABLE messages
      ALTER COLUMN content SET NOT NULL;

    ALTER TABLE messages
      ADD CONSTRAINT messages_content_nonempty CHECK (length(trim(content)) > 0);
  `);
};
