/**
 * Migration: DAW collaborative projects
 * 
 * Tables:
 *  - projects
 *  - project_assets (audio files metadata)
 *  - project_snapshot (current project state)
 *  - project_ops (append-only operations log)
 */

/**
 * @param {import("knex").Knex} knex
 */
exports.up = async function up(knex) {
  // PROJECTS
  await knex.raw(`
    CREATE TABLE projects (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX projects_owner_idx ON projects (owner_user_id);
    CREATE INDEX projects_created_at_idx ON projects (created_at);
  `);

  // PROJECT ASSETS (audio files, samples, etc.)
  await knex.raw(`
    CREATE TABLE project_assets (
      id TEXT PRIMARY KEY, -- UUID/nanoid generated client-side
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, -- 'audio' (could extend to 'video', 'image', etc.)
      name TEXT NOT NULL,
      url TEXT NOT NULL, -- URL or path to asset
      duration REAL, -- duration in seconds (for audio/video)
      file_size BIGINT, -- optional file size in bytes
      mime_type TEXT, -- optional mime type
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX project_assets_project_idx ON project_assets (project_id);
  `);

  // PROJECT SNAPSHOT (current state as JSON)
  await knex.raw(`
    CREATE TABLE project_snapshot (
      project_id BIGINT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      snapshot_json JSONB NOT NULL,
      version_int BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX project_snapshot_updated_idx ON project_snapshot (updated_at);
  `);

  // PROJECT OPS (append-only operations log)
  await knex.raw(`
    CREATE TABLE project_ops (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version_int BIGINT NOT NULL, -- monotonically increasing version
      op_json JSONB NOT NULL, -- the operation itself
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (project_id, version_int)
    );

    CREATE INDEX project_ops_project_version_idx ON project_ops (project_id, version_int);
    CREATE INDEX project_ops_created_idx ON project_ops (created_at);
  `);
};

/**
 * @param {import("knex").Knex} knex
 */
exports.down = async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS project_ops CASCADE;`);
  await knex.raw(`DROP TABLE IF EXISTS project_snapshot CASCADE;`);
  await knex.raw(`DROP TABLE IF EXISTS project_assets CASCADE;`);
  await knex.raw(`DROP TABLE IF EXISTS projects CASCADE;`);
};
