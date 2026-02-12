import path from "path";
import dotenv from "dotenv";

// 1) Load test env before anything else touches process.env
dotenv.config({ path: path.resolve(process.cwd(), ".env.test") });
process.env.NODE_ENV = "test";

// 2) Import your knex instance AFTER env is loaded
// IMPORTANT: change this import to wherever your knex instance lives
import db from "../src/db/knex";

// If you keep migrations in a custom directory, make sure your knex instance knows it.

beforeAll(async () => {
  // Run latest migrations once
  await db.migrate.latest();
});

afterEach(async () => {
  // Fast cleanup between tests (adjust table names if yours differ)
  // CASCADE clears dependent rows; RESTART IDENTITY resets serials
  await db.raw(`
    TRUNCATE TABLE tasks, categories RESTART IDENTITY CASCADE;
  `);

  // If you have more tables, add them to the TRUNCATE list.
});

afterAll(async () => {
  await db.destroy();
});
