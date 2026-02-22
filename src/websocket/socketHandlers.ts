import type { Server as SocketIOServer, Socket } from "socket.io";
import type { Knex } from "knex";
import { knex } from "../db/knex";

// Track connected users per server
interface UserSession {
  userId: string;
  username: string;
  displayName: string | null;
  serverId: number;
}

// Map socket.id -> UserSession
const userSessions = new Map<string, UserSession>();

// Map serverId -> Map of userId to connection count
const serverOnlineUsers = new Map<number, Map<string, number>>();

export function initializeSocketHandlers(io: SocketIOServer) {
  // Global middleware to log all events
  io.use((socket, next) => {
    console.log(`[Socket] Attempting connection from ${socket.handshake.address}`);
    
    // Wrap emit on the socket to log all events
    const originalEmit = socket.emit.bind(socket);
    socket.emit = function (...args: any[]) {
      if (typeof args[0] === "string" && !args[0].startsWith("_")) {
        console.log(`[Socket] ${socket.id} emitting:`, args[0]);
      }
      return originalEmit(...args);
    } as any;
    
    next();
  });

  // Global connection error handler
  io.on("error", (error: any) => {
    console.error(`[Socket.IO] Global error:`, error);
  });

  io.on("connection", (socket: Socket) => {
    console.log(`[Socket] New connection: ${socket.id}`);

    // Error handlers for this socket
    socket.on("error", (error: any) => {
      console.error(`[Socket] ${socket.id} error:`, error);
    });

    // Authenticate and join server room
    socket.on("auth", async (data: any, callback: any) => {
      try {
        console.log(`[Socket] Auth attempt with data:`, data);
        
        const { userId, serverId } = data ?? {};
        const userIdStr = typeof userId === "string" ? userId : String(userId ?? "");
        const serverIdNum = Number(serverId);

        if (!userIdStr || !Number.isFinite(serverIdNum)) {
          console.log(`[Socket] Auth failed: missing userId or serverId`);
          return callback({ error: "INVALID_REQUEST" });
        }

        // Verify user is a member of the server
        const membership = await knex("server_memberships")
          .where("user_id", userIdStr)
          .andWhere("server_id", serverIdNum)
          .first();

        if (!membership) {
          console.log(`[Socket] Auth failed: user ${userId} not member of server ${serverId}`);
          return callback({ error: "FORBIDDEN" });
        }

        // Get user info
        const user = await knex("users").where("id", userIdStr).first();
        if (!user) {
          console.log(`[Socket] Auth failed: user ${userId} not found`);
          return callback({ error: "USER_NOT_FOUND" });
        }

        // Store session
        const session: UserSession = {
          userId: userIdStr,
          username: user.username,
          displayName: user.display_name,
          serverId: serverIdNum,
        };

        userSessions.set(socket.id, session);

        // Track online users for this server
        const serverMap = serverOnlineUsers.get(serverIdNum) ?? new Map<string, number>();
        const prevCount = serverMap.get(userIdStr) ?? 0;
        serverMap.set(userIdStr, prevCount + 1);
        serverOnlineUsers.set(serverIdNum, serverMap);

        // Join the user to a server-specific room
        socket.join(`server:${serverIdNum}`);

        // Broadcast user joined only on first connection
        if (prevCount === 0) {
          io.to(`server:${serverIdNum}`).emit("user:online", {
            userId: userIdStr,
            username: user.username,
            displayName: user.display_name,
          });
        }

        // Send presence sync to the connected socket
        socket.emit("presence:sync", {
          onlineUserIds: Array.from(serverMap.keys()),
        });

        console.log(
          `[Socket] User ${userIdStr} (${user.username}) joined server ${serverIdNum}`
        );

        callback({ success: true });
      } catch (e) {
        console.error("[Socket] Auth error:", e);
        callback({ error: "AUTH_ERROR" });
      }
    });

    // Handle new chat messages
    socket.on("message:send", async (data: any, callback: any) => {
      try {
        const session = userSessions.get(socket.id);
        if (!session) {
          return callback({ error: "UNAUTHORIZED" });
        }

        const { channelId, content } = data ?? {};

        if (typeof content !== "string" || content.trim().length === 0) {
          return callback({ error: "INVALID_MESSAGE" });
        }

        // Verify user is a member of the channel's server
        const channel = await knex("channels")
          .where("id", channelId)
          .andWhere("server_id", session.serverId)
          .first();

        if (!channel) {
          return callback({ error: "FORBIDDEN" });
        }

        // Save message to database
        const [message] = await knex("messages")
          .insert({
            channel_id: channelId,
            user_id: session.userId,
            content: content.trim(),
          })
          .returning(["id", "created_at as createdAt"]);

        // Broadcast to all users in that server
        io.to(`server:${session.serverId}`).emit("message:new", {
          id: message.id,
          channelId,
          content: content.trim(),
          createdAt: message.createdAt,
          user: {
            id: session.userId,
            username: session.username,
            displayName: session.displayName,
          },
        });

        callback({ success: true, messageId: message.id });
      } catch (e) {
        console.error("[Socket] Message send error:", e);
        callback({ error: "MESSAGE_ERROR" });
      }
    });

    // Handle user joining a voice channel
    socket.on("voice:join", async (data: any, callback: any) => {
      try {
        const session = userSessions.get(socket.id);
        if (!session) {
          return callback({ error: "UNAUTHORIZED" });
        }

        const { channelId } = data ?? {};

        if (!channelId) {
          return callback({ error: "INVALID_REQUEST" });
        }

        // Verify it's a voice channel
        const channel = await knex("channels")
          .where("id", channelId)
          .andWhere("server_id", session.serverId)
          .andWhere("type", "voice")
          .first();

        if (!channel) {
          return callback({ error: "FORBIDDEN" });
        }

        // Record voice session start
        const [session_record] = await knex("voice_sessions")
          .insert({
            channel_id: channelId,
            user_id: session.userId,
            joined_at: new Date(),
          })
          .returning(["id"]);

        // Broadcast voice participant update
        const participants = await knex("voice_sessions")
          .join("users", "users.id", "voice_sessions.user_id")
          .select(
            "users.id as userId",
            "users.username",
            "users.display_name as displayName"
          )
          .where("voice_sessions.channel_id", channelId)
          .whereNull("voice_sessions.left_at");

        io.to(`server:${session.serverId}`).emit("voice:participants", {
          channelId,
          participants: participants.map((p: any) => ({
            id: String(p.userId),
            username: p.username,
            displayName: p.displayName ?? null,
          })),
        });

        callback({ success: true, sessionId: session_record.id });
      } catch (e) {
        console.error("[Socket] Voice join error:", e);
        callback({ error: "VOICE_ERROR" });
      }
    });

    // Handle user leaving a voice channel
    socket.on("voice:leave", async (data: any, callback: any) => {
      try {
        const session = userSessions.get(socket.id);
        if (!session) {
          return callback({ error: "UNAUTHORIZED" });
        }

        const { channelId } = data ?? {};

        if (!channelId) {
          return callback({ error: "INVALID_REQUEST" });
        }

        // Mark voice session as ended
        await knex("voice_sessions")
          .where("user_id", session.userId)
          .andWhere("channel_id", channelId)
          .whereNull("left_at")
          .update({ left_at: new Date() });

        // Broadcast updated participants
        const participants = await knex("voice_sessions")
          .join("users", "users.id", "voice_sessions.user_id")
          .select(
            "users.id as userId",
            "users.username",
            "users.display_name as displayName"
          )
          .where("voice_sessions.channel_id", channelId)
          .whereNull("voice_sessions.left_at");

        io.to(`server:${session.serverId}`).emit("voice:participants", {
          channelId,
          participants: participants.map((p: any) => ({
            id: String(p.userId),
            username: p.username,
            displayName: p.displayName ?? null,
          })),
        });

        callback({ success: true });
      } catch (e) {
        console.error("[Socket] Voice leave error:", e);
        callback({ error: "VOICE_ERROR" });
      }
    });

    // Handle disconnect
    socket.on("disconnect", async () => {
      const session = userSessions.get(socket.id);
      if (session) {
        console.log(`[Socket] User ${session.userId} disconnected from server ${session.serverId}`);

        // Clean up voice sessions if user was in voice
        await knex("voice_sessions")
          .where("user_id", session.userId)
          .whereNull("left_at")
          .update({ left_at: new Date() });

        // Remove from online tracking (only emit offline when last connection leaves)
        const onlineUsers = serverOnlineUsers.get(session.serverId);
        if (onlineUsers) {
          const prevCount = onlineUsers.get(session.userId) ?? 0;
          const nextCount = Math.max(0, prevCount - 1);
          if (nextCount === 0) {
            onlineUsers.delete(session.userId);
            io.to(`server:${session.serverId}`).emit("user:offline", {
              userId: session.userId,
            });
          } else {
            onlineUsers.set(session.userId, nextCount);
          }

          if (onlineUsers.size === 0) {
            serverOnlineUsers.delete(session.serverId);
          }
        }

        userSessions.delete(socket.id);
      }
    });
  });
}

// Helper function to get online users for a server (used by REST API)
export async function getOnlineUsersForServer(serverId: number): Promise<string[]> {
  const onlineUsers = serverOnlineUsers.get(serverId);
  return onlineUsers ? Array.from(onlineUsers.keys()) : [];
}

// Helper function to get voice participants (can still be used by REST API)
export async function getVoiceParticipants(serverId: number) {
  const channels = await knex("channels")
    .select("id", "name", "livekit_room_name as livekitRoomName")
    .where("server_id", serverId)
    .andWhere("type", "voice")
    .orderBy("sort_order", "asc")
    .orderBy("id", "asc");

  const channelData = await Promise.all(
    channels.map(async (channel) => {
      const participants = await knex("voice_sessions")
        .join("users", "users.id", "voice_sessions.user_id")
        .select(
          "users.id as userId",
          "users.username",
          "users.display_name as displayName"
        )
        .where("voice_sessions.channel_id", channel.id)
        .whereNull("voice_sessions.left_at");

      return {
        id: channel.id,
        name: channel.name,
        livekitRoomName: channel.livekitRoomName,
        participants: participants.map((p: any) => ({
          id: String(p.userId),
          username: p.username,
          displayName: p.displayName ?? null,
        })),
      };
    })
  );

  return { channels: channelData };
}
