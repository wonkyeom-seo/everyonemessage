import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { AppConfig } from "./config";
import type { Db } from "./db";
import { queryOne } from "./db";
import { verifyAuthHeader } from "./auth";

export interface Realtime {
  io: Server;
  emitToConversation: (conversationId: string, event: string, payload: unknown) => void;
  emitToUser: (userId: string, event: string, payload: unknown) => void;
}

export function createRealtime(httpServer: HttpServer, config: AppConfig, db: Db): Realtime {
  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: {
      origin: config.WEB_ORIGIN,
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token as string | undefined;
      const auth = await verifyAuthHeader(config, token ? `Bearer ${token}` : undefined);
      const user = await queryOne<{ id: string }>(
        db,
        "SELECT id FROM users WHERE firebase_uid = $1",
        [auth.firebaseUid]
      );
      if (!user) {
        return next(new Error("profile_required"));
      }
      socket.data.userId = user.id;
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);

    socket.on("conversation:join", async (conversationId: string) => {
      const member = await queryOne<{ conversation_id: string }>(
        db,
        `SELECT conversation_id FROM conversation_members
         WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
        [conversationId, userId]
      );
      if (member) {
        socket.join(`conversation:${conversationId}`);
      }
    });

    socket.on("typing:start", (payload: { conversationId: string }) => {
      socket.to(`conversation:${payload.conversationId}`).emit("typing:update", {
        conversationId: payload.conversationId,
        userId,
        typing: true
      });
    });

    socket.on("typing:stop", (payload: { conversationId: string }) => {
      socket.to(`conversation:${payload.conversationId}`).emit("typing:update", {
        conversationId: payload.conversationId,
        userId,
        typing: false
      });
    });
  });

  return {
    io,
    emitToConversation(conversationId, event, payload) {
      io.to(`conversation:${conversationId}`).emit(event, payload);
    },
    emitToUser(userId, event, payload) {
      io.to(`user:${userId}`).emit(event, payload);
    }
  };
}
