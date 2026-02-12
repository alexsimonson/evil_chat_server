const bcrypt = require("bcryptjs");

/**
 * @param {import("knex").Knex} knex
 */
exports.seed = async function seed(knex) {
  // Clear in dependency order
  await knex('voice_sessions').del();
  await knex('messages').del();
  await knex('channels').del();
  await knex('server_memberships').del();
  await knex('servers').del();
  await knex('invites').del();
  await knex('users').del();

  // ---- HASH TEST PASSWORD ----
  const TEST_PASSWORD = "password";
  const password_hash = await bcrypt.hash(TEST_PASSWORD, 10);

  // ---- USERS ----
  const [userA] = await knex('users')
    .insert({
      email: 'alex@test.com',
      username: 'alex',
      password_hash,
      display_name: 'Alex'
    })
    .returning('*');

  const [userB] = await knex('users')
    .insert({
      email: 'sam@test.com',
      username: 'sam',
      password_hash,
      display_name: 'Sam'
    })
    .returning('*');

  // ---- SERVER ----
  const [server] = await knex('servers')
    .insert({
      name: 'MVP Server',
      owner_user_id: userA.id
    })
    .returning('*');

  // ---- MEMBERSHIPS ----
  await knex('server_memberships').insert([
    {
      server_id: server.id,
      user_id: userA.id,
      role: 'owner'
    },
    {
      server_id: server.id,
      user_id: userB.id,
      role: 'member'
    }
  ]);

  // ---- CHANNELS ----
  const [textChannel] = await knex('channels')
    .insert({
      server_id: server.id,
      name: 'general',
      type: 'text',
      sort_order: 1
    })
    .returning('*');

  await knex('channels')
    .insert({
      server_id: server.id,
      name: 'General Voice',
      type: 'voice',
      sort_order: 2,
      livekit_room_name: `server_${server.id}_voice_general`
    })
    .returning('*');

  // ---- MESSAGES ----
  await knex('messages').insert([
    {
      channel_id: textChannel.id,
      user_id: userA.id,
      content: 'Welcome to the MVP server 👋'
    },
    {
      channel_id: textChannel.id,
      user_id: userB.id,
      content: 'Let’s test realtime chat.'
    }
  ]);

  console.log('MVP seed complete. Test password is: "password"');
};
