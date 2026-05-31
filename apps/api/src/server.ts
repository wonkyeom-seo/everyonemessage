import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import type { FastifyInstance, FastifyRequest } from "fastify";
import Fastify from "fastify";
import {
  createDirectConversationSchema,
  createFriendRequestSchema,
  createGroupConversationSchema,
  createMessageSchema,
  createReportSchema,
  createStatusSchema,
  displayEmHandle,
  emHandleSchema,
  emHandleSearchSchema,
  extractHttpUrls,
  normalizeEmHandle,
  onboardingSchema,
  updateMessageSchema,
  updateProfileSchema
} from "@em/shared";
import type { AppConfig } from "./config";
import type { AuthUser } from "./auth";
import { verifyAuthHeader } from "./auth";
import type { Db } from "./db";
import { queryMany, queryOne } from "./db";
import { HttpError, sendError } from "./errors";
import { sendWebPush } from "./push";
import type { Realtime } from "./realtime";
import { createUploadUrl, readLocalFile, saveLocalUpload, saveLocalUserFile, type StorageService } from "./storage";

interface Runtime {
  realtime: Realtime | null;
}

interface UserRow {
  id: string;
  firebase_uid: string;
  email: string;
  email_verified: boolean;
  name: string | null;
  em_handle: string | null;
  avatar_url: string | null;
  bio: string | null;
  onboarded_at: string | null;
  created_at: string;
}

interface AuthedContext {
  auth: AuthUser;
  user: UserRow;
}

export function createApi(config: AppConfig, db: Db, storage: StorageService, runtime: Runtime): FastifyInstance {
  const app = Fastify({
    bodyLimit: 50 * 1024 * 1024,
    logger: {
      level: config.NODE_ENV === "production" ? "info" : "warn"
    }
  });

  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 50 * 1024 * 1024 }, (_request, body, done) => {
    done(null, body);
  });

  app.register(helmet, { global: true });
  app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true
  });

  app.setErrorHandler((error, _request, reply) => {
    _request.log.error(error);
    sendError(reply, error);
  });

  app.get("/api/health", async () => ({ ok: true, service: "everyonemessage-api" }));

  app.get("/files/*", async (request, reply) => {
    if (config.FILE_STORAGE !== "local") {
      throw new HttpError(404, "파일을 찾을 수 없습니다.");
    }
    const key = (request.params as { "*": string })["*"];
    const file = await readLocalFile(config, key);
    if (!file) {
      throw new HttpError(404, "파일을 찾을 수 없습니다.");
    }
    reply.header("Content-Type", file.contentType);
    reply.header("Content-Length", String(file.size));
    return reply.send(file.stream);
  });

  app.get("/api/me", async (request) => {
    const { user } = await getOptionalProfile(request, db, config);
    return { user: toMe(user) };
  });

  app.post("/api/me/onboarding", async (request) => {
    const { auth, user } = await getOptionalProfile(request, db, config);
    const input = onboardingSchema.parse(request.body);
    await assertHandleAvailable(db, input.emHandle, user.id);
    const updated = await queryOne<UserRow>(
      db,
      `UPDATE users
       SET name = $2, em_handle = $3, email = $4, email_verified = $5, onboarded_at = COALESCE(onboarded_at, now()), updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [user.id, input.name, input.emHandle, auth.email, auth.emailVerified]
    );
    return { user: toMe(requireRow(updated)) };
  });

  app.patch("/api/me/profile", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const input = updateProfileSchema.parse(request.body);
    const updated = await queryOne<UserRow>(
      db,
      `UPDATE users
       SET name = COALESCE($2, name), avatar_url = COALESCE($3, avatar_url), bio = COALESCE($4, bio), updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [user.id, input.name ?? null, input.avatarUrl ?? null, input.bio ?? null]
    );
    return { user: toMe(requireRow(updated)) };
  });

  app.put("/api/me/avatar", async (request) => {
    const { user } = await requireProfile(request, db, config);
    if (config.FILE_STORAGE !== "local") {
      throw new HttpError(400, "현재 서버는 로컬 프로필 업로드가 비활성화되어 있습니다.");
    }
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new HttpError(400, "업로드할 이미지가 필요합니다.");
    }
    if (body.length > 10 * 1024 * 1024) {
      throw new HttpError(400, "프로필 이미지는 10MB 이하만 업로드할 수 있습니다.");
    }
    const contentType = String(request.headers["content-type"] ?? "application/octet-stream").split(";")[0];
    if (!contentType.startsWith("image/")) {
      throw new HttpError(400, "이미지 파일만 프로필 사진으로 사용할 수 있습니다.");
    }
    const rawFileName = request.headers["x-file-name"];
    const fileName = Array.isArray(rawFileName) ? rawFileName[0] : rawFileName;
    const saved = await saveLocalUserFile(config, user.id, fileName ? decodeURIComponent(fileName) : "avatar", contentType, body);
    const updated = await queryOne<UserRow>(
      db,
      "UPDATE users SET avatar_url = $2, updated_at = now() WHERE id = $1 RETURNING *",
      [user.id, saved.publicUrl]
    );
    return { user: toMe(requireRow(updated)) };
  });

  app.patch("/api/me/em-id", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const emHandle = emHandleSchema.parse((request.body as { emHandle?: string })?.emHandle);
    if (emHandle === user.em_handle) {
      return { user: toMe(user) };
    }
    await assertHandleAvailable(db, emHandle, user.id);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      if (user.em_handle) {
        await client.query(
          `INSERT INTO em_handle_history (user_id, handle, replaced_by_handle, protected_until)
           VALUES ($1, $2, $3, now() + interval '20 days')
           ON CONFLICT (handle) DO UPDATE
           SET user_id = EXCLUDED.user_id,
               replaced_by_handle = EXCLUDED.replaced_by_handle,
               protected_until = EXCLUDED.protected_until,
               created_at = now()`,
          [user.id, user.em_handle, emHandle]
        );
      }
      const result = await client.query<UserRow>(
        "UPDATE users SET em_handle = $2, updated_at = now() WHERE id = $1 RETURNING *",
        [user.id, emHandle]
      );
      await client.query("COMMIT");
      return { user: toMe(requireRow(result.rows[0])) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/me/status", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const input = createStatusSchema.parse(request.body);
    const status = await queryOne(
      db,
      `INSERT INTO statuses (user_id, text, visibility, expires_at)
       VALUES ($1, $2, $3, now() + interval '24 hours')
       RETURNING id, text, visibility, expires_at AS "expiresAt", created_at AS "createdAt"`,
      [user.id, input.text, input.visibility]
    );
    runtime.realtime?.emitToUser(user.id, "status:update", status);
    return { status };
  });

  app.delete("/api/me/status/:id", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const { id } = request.params as { id: string };
    await db.query("DELETE FROM statuses WHERE id = $1 AND user_id = $2", [id, user.id]);
    return { ok: true };
  });

  app.get("/api/users/search", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const raw = (request.query as { emId?: string }).emId ?? "";
    const emHandle = emHandleSearchSchema.parse(raw);
    const results = await findSearchResults(db, user.id, emHandle);
    const exact = results.find((item) => normalizeEmHandle(item.emHandle) === emHandle);
    const history = await queryOne<{
      user_id: string;
      previous_handle: string;
      current_handle: string;
      protected_until: string;
    }>(
      db,
      `SELECT h.user_id,
              h.handle AS previous_handle,
              u.em_handle AS current_handle,
              h.protected_until::text
       FROM em_handle_history h
       JOIN users u ON u.id = h.user_id
      WHERE h.handle = $1 AND h.protected_until > now()`,
      [emHandle]
    );
    if (!history) {
      return { result: exact ?? results[0] ?? null, results };
    }
    const result = await findSearchResult(db, user.id, history.current_handle);
    const resultWithNotice = result
      ? {
          ...result,
          previousHandleNotice: {
            previousHandle: displayEmHandle(history.previous_handle),
            currentHandle: displayEmHandle(history.current_handle),
            protectedUntil: history.protected_until
          }
        }
      : null;
    const mergedResults = resultWithNotice
      ? [resultWithNotice, ...results.filter((item) => item.id !== resultWithNotice.id)]
      : results;
    return {
      result: resultWithNotice ?? exact ?? results[0] ?? null,
      results: mergedResults
    };
  });

  app.get("/api/friends", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const friends = await queryMany(
      db,
      `WITH friend_ids AS (
         SELECT CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END AS friend_id
         FROM friendships
         WHERE user_a_id = $1 OR user_b_id = $1
       )
       SELECT u.id, u.name, u.em_handle AS "emHandle", u.avatar_url AS "avatarUrl",
              s.text AS "statusText", s.visibility AS "statusVisibility"
       FROM friend_ids f
       JOIN users u ON u.id = f.friend_id
       LEFT JOIN LATERAL (
         SELECT text, visibility FROM statuses
         WHERE user_id = u.id AND expires_at > now()
         ORDER BY created_at DESC
         LIMIT 1
       ) s ON true
       ORDER BY u.name ASC`,
      [user.id]
    );
    return { friends };
  });

  app.get("/api/friends/requests", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const requests = await queryMany(
      db,
      `SELECT fr.id, fr.state, fr.created_at AS "createdAt",
              requester.id AS "requesterId", requester.name AS "requesterName", requester.em_handle AS "requesterEmHandle",
              addressee.id AS "addresseeId", addressee.name AS "addresseeName", addressee.em_handle AS "addresseeEmHandle"
       FROM friend_requests fr
       JOIN users requester ON requester.id = fr.requester_id
       JOIN users addressee ON addressee.id = fr.addressee_id
       WHERE (fr.requester_id = $1 OR fr.addressee_id = $1) AND fr.state = 'pending'
       ORDER BY fr.created_at DESC`,
      [user.id]
    );
    return { requests };
  });

  app.post("/api/friends/requests", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const input = createFriendRequestSchema.parse(request.body);
    if (input.targetUserId === user.id) {
      throw new HttpError(400, "자기 자신에게 친구 요청을 보낼 수 없습니다.");
    }
    await assertNotBlocked(db, user.id, input.targetUserId);
    if (await areFriends(db, user.id, input.targetUserId)) {
      throw new HttpError(409, "이미 친구입니다.");
    }
    const existingIncoming = await queryOne(
      db,
      `SELECT id FROM friend_requests
       WHERE requester_id = $1 AND addressee_id = $2 AND state = 'pending'`,
      [input.targetUserId, user.id]
    );
    if (existingIncoming) {
      throw new HttpError(409, "상대가 이미 보낸 친구 요청이 있습니다.");
    }
    const created = await queryOne(
      db,
      `INSERT INTO friend_requests (requester_id, addressee_id, state)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (requester_id, addressee_id) DO UPDATE
       SET state = 'pending', created_at = now(), responded_at = null
       RETURNING id, state, created_at AS "createdAt"`,
      [user.id, input.targetUserId]
    );
    if (!created) {
      throw new HttpError(500, "친구 요청을 만들지 못했습니다.");
    }
    await createNotification(db, config, runtime, input.targetUserId, {
      kind: "friend_request",
      title: "친구 요청",
      body: `${user.name}님이 친구 요청을 보냈습니다.`,
      linkPath: `/friends?focus=requests&requestId=${created.id}`
    });
    return { request: created };
  });

  app.post("/api/friends/requests/:id/accept", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const { id } = request.params as { id: string };
    const friendRequest = await queryOne<{ requester_id: string; addressee_id: string }>(
      db,
      "SELECT requester_id, addressee_id FROM friend_requests WHERE id = $1 AND addressee_id = $2 AND state = 'pending'",
      [id, user.id]
    );
    if (!friendRequest) {
      throw new HttpError(404, "친구 요청을 찾을 수 없습니다.");
    }
    const [a, b] = orderedPair(friendRequest.requester_id, friendRequest.addressee_id);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE friend_requests SET state = 'accepted', responded_at = now() WHERE id = $1", [id]);
      await client.query(
        "INSERT INTO friendships (user_a_id, user_b_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [a, b]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await createNotification(db, config, runtime, friendRequest.requester_id, {
      kind: "friend_accept",
      title: "친구 요청 수락",
      body: `${user.name}님과 친구가 되었습니다.`,
      linkPath: "/friends"
    });
    return { ok: true };
  });

  app.post("/api/friends/requests/:id/decline", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const { id } = request.params as { id: string };
    await db.query(
      "UPDATE friend_requests SET state = 'declined', responded_at = now() WHERE id = $1 AND addressee_id = $2",
      [id, user.id]
    );
    return { ok: true };
  });

  app.get("/api/friends/recommendations", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const recommendations = await queryMany(
      db,
      `WITH my_friends AS (
         SELECT CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END AS friend_id
         FROM friendships
         WHERE user_a_id = $1 OR user_b_id = $1
       ),
       candidates AS (
         SELECT CASE WHEN f.user_a_id = mf.friend_id THEN f.user_b_id ELSE f.user_a_id END AS candidate_id,
                mf.friend_id AS mutual_id
         FROM my_friends mf
         JOIN friendships f ON f.user_a_id = mf.friend_id OR f.user_b_id = mf.friend_id
       )
       SELECT u.id, u.name, u.em_handle AS "emHandle", u.avatar_url AS "avatarUrl",
              COUNT(DISTINCT c.mutual_id)::int AS "mutualCount",
              (ARRAY_REMOVE(ARRAY_AGG(DISTINCT mf_user.name), NULL))[1:3] AS "mutualNames",
              s.text AS "statusText"
       FROM candidates c
       JOIN users u ON u.id = c.candidate_id
       JOIN users mf_user ON mf_user.id = c.mutual_id
       LEFT JOIN LATERAL (
         SELECT text FROM statuses
         WHERE user_id = u.id AND expires_at > now() AND visibility IN ('public', 'friends')
         ORDER BY created_at DESC
         LIMIT 1
       ) s ON true
       WHERE c.candidate_id <> $1
         AND NOT EXISTS (SELECT 1 FROM my_friends WHERE friend_id = c.candidate_id)
         AND NOT EXISTS (
           SELECT 1 FROM friend_requests fr
           WHERE fr.state = 'pending'
             AND ((fr.requester_id = $1 AND fr.addressee_id = c.candidate_id)
               OR (fr.requester_id = c.candidate_id AND fr.addressee_id = $1))
         )
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_id = $1 AND b.blocked_id = c.candidate_id)
              OR (b.blocker_id = c.candidate_id AND b.blocked_id = $1)
         )
       GROUP BY u.id, s.text
       ORDER BY "mutualCount" DESC, u.name ASC
       LIMIT 30`,
      [user.id]
    );
    return { recommendations };
  });

  app.get("/api/conversations", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const conversations = await queryMany(
      db,
      `WITH mine AS (
         SELECT c.*
         FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id = c.id
         WHERE cm.user_id = $1 AND cm.left_at IS NULL
       ),
       last_messages AS (
         SELECT DISTINCT ON (conversation_id)
                conversation_id, id, text, kind, created_at
         FROM messages
         WHERE deleted_for_all_at IS NULL
         ORDER BY conversation_id, created_at DESC
       )
       SELECT m.id, m.kind, m.title, m.avatar_url AS "avatarUrl",
              lm.text AS "lastMessageText", lm.created_at::text AS "lastMessageAt",
              COUNT(DISTINCT cm_all.user_id)::int AS "memberCount",
              COUNT(unread.id)::int AS "unreadCount",
              direct_peer.name AS "directPeerName", direct_peer.avatar_url AS "directPeerAvatarUrl"
       FROM mine m
       JOIN conversation_members cm_self ON cm_self.conversation_id = m.id AND cm_self.user_id = $1
       JOIN conversation_members cm_all ON cm_all.conversation_id = m.id AND cm_all.left_at IS NULL
       LEFT JOIN last_messages lm ON lm.conversation_id = m.id
       LEFT JOIN messages unread ON unread.conversation_id = m.id
         AND unread.sender_id <> $1
         AND unread.deleted_for_all_at IS NULL
         AND (cm_self.last_read_at IS NULL OR unread.created_at > cm_self.last_read_at)
       LEFT JOIN direct_conversations dc ON dc.conversation_id = m.id
       LEFT JOIN users direct_peer ON direct_peer.id = CASE WHEN dc.user_a_id = $1 THEN dc.user_b_id ELSE dc.user_a_id END
       GROUP BY m.id, m.kind, m.title, m.avatar_url, m.updated_at, lm.text, lm.created_at, direct_peer.name, direct_peer.avatar_url
       ORDER BY COALESCE(lm.created_at, m.updated_at) DESC`,
      [user.id]
    );
    return {
      conversations: conversations.map((conversation: any) => ({
        id: conversation.id,
        kind: conversation.kind,
        title: conversation.kind === "direct" ? conversation.directPeerName ?? conversation.title ?? "나와의 채팅" : conversation.title,
        avatarUrl: conversation.kind === "direct" ? conversation.directPeerAvatarUrl ?? conversation.avatarUrl : conversation.avatarUrl,
        lastMessageText: conversation.lastMessageText,
        lastMessageAt: conversation.lastMessageAt,
        unreadCount: Number(conversation.unreadCount),
        memberCount: Number(conversation.memberCount)
      }))
    };
  });

  app.post("/api/conversations/direct", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const input = createDirectConversationSchema.parse(request.body);
    if (!(await areFriends(db, user.id, input.friendUserId))) {
      throw new HttpError(403, "친구와만 DM을 시작할 수 있습니다.");
    }
    await assertNotBlocked(db, user.id, input.friendUserId);
    const [a, b] = orderedPair(user.id, input.friendUserId);
    const existing = await queryOne<{ conversation_id: string }>(
      db,
      "SELECT conversation_id FROM direct_conversations WHERE user_a_id = $1 AND user_b_id = $2",
      [a, b]
    );
    if (existing) {
      return { conversationId: existing.conversation_id };
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const conversation = await client.query<{ id: string }>(
        "INSERT INTO conversations (kind, created_by) VALUES ('direct', $1) RETURNING id",
        [user.id]
      );
      const conversationId = conversation.rows[0].id;
      await client.query(
        "INSERT INTO direct_conversations (conversation_id, user_a_id, user_b_id) VALUES ($1, $2, $3)",
        [conversationId, a, b]
      );
      await client.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
        [conversationId, user.id, input.friendUserId]
      );
      await client.query("COMMIT");
      return { conversationId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/conversations/self", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const existing = await queryOne<{ id: string }>(
      db,
      `SELECT c.id
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1 AND cm.left_at IS NULL
       WHERE c.created_by = $1
         AND c.title = '나와의 채팅'
         AND NOT EXISTS (
           SELECT 1 FROM conversation_members other
           WHERE other.conversation_id = c.id AND other.user_id <> $1 AND other.left_at IS NULL
         )
       LIMIT 1`,
      [user.id]
    );
    if (existing) {
      return { conversationId: existing.id };
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const conversation = await client.query<{ id: string }>(
        "INSERT INTO conversations (kind, title, created_by) VALUES ('group', '나와의 채팅', $1) RETURNING id",
        [user.id]
      );
      const conversationId = conversation.rows[0].id;
      await client.query(
        "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')",
        [conversationId, user.id]
      );
      await client.query("COMMIT");
      return { conversationId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/conversations/group", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const input = createGroupConversationSchema.parse(request.body);
    const uniqueMembers = Array.from(new Set(input.memberUserIds.filter((id) => id !== user.id)));
    for (const memberId of uniqueMembers) {
      if (!(await areFriends(db, user.id, memberId))) {
        throw new HttpError(403, "그룹에는 친구만 초대할 수 있습니다.");
      }
      await assertNotBlocked(db, user.id, memberId);
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const conversation = await client.query<{ id: string }>(
        "INSERT INTO conversations (kind, title, created_by) VALUES ('group', $1, $2) RETURNING id",
        [input.name, user.id]
      );
      const conversationId = conversation.rows[0].id;
      await client.query(
        "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')",
        [conversationId, user.id]
      );
      for (const memberId of uniqueMembers) {
        await client.query(
          "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'member')",
          [conversationId, memberId]
        );
      }
      await client.query("COMMIT");
      for (const memberId of uniqueMembers) {
        await createNotification(db, config, runtime, memberId, {
          kind: "group_invite",
          title: "그룹 초대",
          body: `${user.name}님이 ${input.name} 그룹에 초대했습니다.`,
          linkPath: `/chats/${conversationId}`
        });
      }
      return { conversationId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/api/conversations/:id/messages", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const { id } = request.params as { id: string };
    await assertConversationMember(db, id, user.id);
    const before = (request.query as { before?: string }).before;
    const messages = await queryMany(
      db,
      `SELECT m.id, m.conversation_id AS "conversationId", m.sender_id AS "senderId",
              sender.name AS "senderName", m.kind, m.text, m.attachments, m.link_previews AS "linkPreviews",
              m.edited_at::text AS "editedAt", m.deleted_for_all_at::text AS "deletedForAllAt",
              m.created_at::text AS "createdAt"
       FROM messages m
       LEFT JOIN users sender ON sender.id = m.sender_id
       WHERE m.conversation_id = $1
         AND NOT EXISTS (SELECT 1 FROM message_deletions md WHERE md.message_id = m.id AND md.user_id = $2)
         AND ($3::timestamptz IS NULL OR m.created_at < $3::timestamptz)
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [id, user.id, before ?? null]
    );
    return { messages: messages.reverse() };
  });

  app.post("/api/conversations/:id/messages", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const { id } = request.params as { id: string };
    await assertConversationMember(db, id, user.id);
    const input = createMessageSchema.parse(request.body);
    if (!input.text && input.attachments.length === 0) {
      throw new HttpError(400, "메시지 내용 또는 첨부파일이 필요합니다.");
    }
    const urls = extractHttpUrls(input.text ?? "");
    const linkPreviews = urls.map((url) => ({
      url,
      domain: new URL(url).hostname,
      title: new URL(url).hostname
    }));
    const message = await queryOne(
      db,
      `INSERT INTO messages (conversation_id, sender_id, kind, text, attachments, link_previews, client_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
       ON CONFLICT (conversation_id, sender_id, client_id) DO UPDATE SET client_id = EXCLUDED.client_id
       RETURNING id, conversation_id AS "conversationId", sender_id AS "senderId", kind, text,
                 attachments, link_previews AS "linkPreviews", created_at::text AS "createdAt",
                 edited_at::text AS "editedAt", deleted_for_all_at::text AS "deletedForAllAt"`,
      [
        id,
        user.id,
        input.kind,
        input.text ?? null,
        JSON.stringify(input.attachments),
        JSON.stringify(linkPreviews),
        input.clientId ?? null
      ]
    );
    await db.query("UPDATE conversations SET updated_at = now() WHERE id = $1", [id]);
    runtime.realtime?.emitToConversation(id, "message:new", message);
    const members = await queryMany<{ user_id: string }>(
      db,
      "SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2 AND left_at IS NULL",
      [id, user.id]
    );
    for (const member of members) {
      await createNotification(db, config, runtime, member.user_id, {
        kind: "message",
        title: user.name ?? "새 메시지",
        body: input.text?.slice(0, 80) || "첨부파일을 보냈습니다.",
        linkPath: `/chats/${id}`
      });
    }
    return { message };
  });

  app.patch("/api/messages/:id", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const { id } = request.params as { id: string };
    const input = updateMessageSchema.parse(request.body);
    const message = await queryOne<{ conversationId: string }>(
      db,
      `UPDATE messages
       SET text = $2, edited_at = now(), link_previews = $3::jsonb
       WHERE id = $1 AND sender_id = $4 AND deleted_for_all_at IS NULL
       RETURNING conversation_id AS "conversationId"`,
      [id, input.text, JSON.stringify(extractHttpUrls(input.text).map((url) => ({ url, domain: new URL(url).hostname }))), user.id]
    );
    if (!message) {
      throw new HttpError(404, "수정할 메시지를 찾을 수 없습니다.");
    }
    runtime.realtime?.emitToConversation(message.conversationId, "message:edit", { id, text: input.text });
    return { ok: true };
  });

  app.delete("/api/messages/:id", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const { id } = request.params as { id: string };
    const scope = ((request.query as { scope?: string }).scope ?? "me") as "me" | "all";
    const message = await queryOne<{ conversation_id: string; sender_id: string; created_at: string }>(
      db,
      "SELECT conversation_id, sender_id, created_at::text FROM messages WHERE id = $1",
      [id]
    );
    if (!message) {
      throw new HttpError(404, "메시지를 찾을 수 없습니다.");
    }
    await assertConversationMember(db, message.conversation_id, user.id);
    if (scope === "all") {
      if (message.sender_id !== user.id) {
        throw new HttpError(403, "내가 보낸 메시지만 모두에게 삭제할 수 있습니다.");
      }
      const updated = await queryOne(
        db,
        `UPDATE messages
         SET deleted_for_all_at = now(), text = null, attachments = '[]'::jsonb, link_previews = '[]'::jsonb
         WHERE id = $1 AND created_at > now() - interval '10 minutes'
         RETURNING id`,
        [id]
      );
      if (!updated) {
        throw new HttpError(403, "모두에게 삭제는 보낸 뒤 10분 안에만 가능합니다.");
      }
      runtime.realtime?.emitToConversation(message.conversation_id, "message:delete", { id, scope });
      return { ok: true };
    }
    await db.query(
      "INSERT INTO message_deletions (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [id, user.id]
    );
    return { ok: true };
  });

  app.post("/api/conversations/:id/read", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const { id } = request.params as { id: string };
    await assertConversationMember(db, id, user.id);
    await db.query(
      "UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2",
      [id, user.id]
    );
    runtime.realtime?.emitToConversation(id, "message:read", { conversationId: id, userId: user.id });
    return { ok: true };
  });

  app.post("/api/uploads/presign", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const body = request.body as { fileName?: string; contentType?: string; size?: number };
    if (!body.fileName || !body.contentType || !body.size) {
      throw new HttpError(400, "파일 이름, 타입, 크기가 필요합니다.");
    }
    const maxSize = body.contentType.startsWith("image/") ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
    if (body.size > maxSize) {
      throw new HttpError(400, "파일 크기가 제한을 초과했습니다.");
    }
    return createUploadUrl(storage, config, user.id, body.fileName, body.contentType);
  });

  app.put("/api/uploads/local/:token", async (request) => {
    if (config.FILE_STORAGE !== "local") {
      throw new HttpError(404, "로컬 파일 업로드가 비활성화되어 있습니다.");
    }
    const { token } = request.params as { token: string };
    const body = request.body;
    if (!Buffer.isBuffer(body)) {
      throw new HttpError(400, "업로드 파일 본문이 필요합니다.");
    }
    return saveLocalUpload(config, token, body);
  });

  app.post("/api/blocks", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const blockedUserId = (request.body as { blockedUserId?: string }).blockedUserId;
    if (!blockedUserId || blockedUserId === user.id) {
      throw new HttpError(400, "차단할 사용자를 확인해주세요.");
    }
    await db.query("INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
      user.id,
      blockedUserId
    ]);
    return { ok: true };
  });

  app.delete("/api/blocks/:userId", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const { userId } = request.params as { userId: string };
    await db.query("DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2", [user.id, userId]);
    return { ok: true };
  });

  app.post("/api/reports", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const input = createReportSchema.parse(request.body);
    const report = await queryOne(
      db,
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, details, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, state, created_at AS "createdAt"`,
      [user.id, input.targetType, input.targetId, input.reason, input.details ?? null, JSON.stringify({})]
    );
    return { report };
  });

  app.get("/api/notifications", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const notifications = await queryMany(
      db,
      `SELECT id, kind, title, body, link_path AS "linkPath", read_at::text AS "readAt", created_at::text AS "createdAt"
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [user.id]
    );
    return { notifications };
  });

  app.post("/api/notifications/:id/read", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const { id } = request.params as { id: string };
    await db.query("UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2", [id, user.id]);
    return { ok: true };
  });

  app.post("/api/push/subscriptions", async (request) => {
    const { user } = await requireProfile(request, db, config);
    const body = request.body as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!body.endpoint || !body.keys?.p256dh || !body.keys.auth) {
      throw new HttpError(400, "푸시 구독 정보가 올바르지 않습니다.");
    }
    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [user.id, body.endpoint, body.keys.p256dh, body.keys.auth]
    );
    return { ok: true };
  });

  return app;
}

async function getOptionalProfile(request: FastifyRequest, db: Db, config: AppConfig): Promise<AuthedContext> {
  const auth = await verifyAuthHeader(config, request.headers.authorization);
  const user =
    (await queryOne<UserRow>(db, "SELECT * FROM users WHERE firebase_uid = $1", [auth.firebaseUid])) ??
    (await queryOne<UserRow>(
      db,
      `INSERT INTO users (firebase_uid, email, email_verified)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [auth.firebaseUid, auth.email, auth.emailVerified]
    ));
  return { auth, user: requireRow(user) };
}

async function requireProfile(request: FastifyRequest, db: Db, config: AppConfig): Promise<AuthedContext> {
  const context = await getOptionalProfile(request, db, config);
  if (!context.user.onboarded_at || !context.user.em_handle || !context.user.name) {
    throw new HttpError(409, "프로필 설정이 필요합니다.");
  }
  return context;
}

function requireRow<T>(row: T | null | undefined): T {
  if (!row) {
    throw new HttpError(404, "대상을 찾을 수 없습니다.");
  }
  return row;
}

function toMe(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.email_verified,
    name: user.name,
    emHandle: user.em_handle ? displayEmHandle(user.em_handle) : null,
    avatarUrl: user.avatar_url,
    bio: user.bio,
    onboarded: Boolean(user.onboarded_at)
  };
}

async function assertHandleAvailable(db: Db, handle: string, currentUserId: string): Promise<void> {
  const normalized = normalizeEmHandle(handle);
  const current = await queryOne<{ id: string }>(
    db,
    "SELECT id FROM users WHERE em_handle = $1 AND id <> $2",
    [normalized, currentUserId]
  );
  if (current) {
    throw new HttpError(409, "이미 사용 중인 em아이디입니다.");
  }
  const protectedHandle = await queryOne<{ user_id: string }>(
    db,
    `SELECT user_id FROM em_handle_history
     WHERE handle = $1 AND protected_until > now() AND user_id <> $2`,
    [normalized, currentUserId]
  );
  if (protectedHandle) {
    throw new HttpError(409, "보호 기간 중인 em아이디입니다.");
  }
}

async function findSearchResult(db: Db, viewerId: string, emHandle: string) {
  const row = await queryOne<any>(
    db,
    `SELECT u.id, u.name, u.em_handle AS "emHandle", u.avatar_url AS "avatarUrl",
            CASE
              WHEN u.id = $1 THEN 'self'
              WHEN EXISTS (SELECT 1 FROM friendships f WHERE (f.user_a_id = $1 AND f.user_b_id = u.id) OR (f.user_b_id = $1 AND f.user_a_id = u.id)) THEN 'friend'
              WHEN EXISTS (SELECT 1 FROM friend_requests fr WHERE fr.requester_id = $1 AND fr.addressee_id = u.id AND fr.state = 'pending') THEN 'request_sent'
              WHEN EXISTS (SELECT 1 FROM friend_requests fr WHERE fr.requester_id = u.id AND fr.addressee_id = $1 AND fr.state = 'pending') THEN 'request_received'
              ELSE 'none'
            END AS relation,
            s.text AS "statusText",
            s.visibility AS "statusVisibility"
     FROM users u
     LEFT JOIN LATERAL (
       SELECT text, visibility FROM statuses
       WHERE user_id = u.id AND expires_at > now()
         AND (u.id = $1 OR visibility = 'public' OR EXISTS (
           SELECT 1 FROM friendships f
           WHERE (f.user_a_id = $1 AND f.user_b_id = u.id) OR (f.user_b_id = $1 AND f.user_a_id = u.id)
         ))
       ORDER BY created_at DESC
       LIMIT 1
     ) s ON true
     WHERE u.em_handle = $2
       AND NOT EXISTS (
         SELECT 1 FROM blocks b
         WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
            OR (b.blocker_id = u.id AND b.blocked_id = $1)
       )`,
    [viewerId, emHandle]
  );
  if (!row) {
    return null;
  }
  return { ...row, emHandle: displayEmHandle(row.emHandle) };
}

async function findSearchResults(db: Db, viewerId: string, emHandleQuery: string) {
  const rows = await queryMany<any>(
    db,
    `SELECT u.id, u.name, u.em_handle AS "emHandle", u.avatar_url AS "avatarUrl",
            CASE
              WHEN u.id = $1 THEN 'self'
              WHEN EXISTS (SELECT 1 FROM friendships f WHERE (f.user_a_id = $1 AND f.user_b_id = u.id) OR (f.user_b_id = $1 AND f.user_a_id = u.id)) THEN 'friend'
              WHEN EXISTS (SELECT 1 FROM friend_requests fr WHERE fr.requester_id = $1 AND fr.addressee_id = u.id AND fr.state = 'pending') THEN 'request_sent'
              WHEN EXISTS (SELECT 1 FROM friend_requests fr WHERE fr.requester_id = u.id AND fr.addressee_id = $1 AND fr.state = 'pending') THEN 'request_received'
              ELSE 'none'
            END AS relation,
            s.text AS "statusText",
            s.visibility AS "statusVisibility"
     FROM users u
     LEFT JOIN LATERAL (
       SELECT text, visibility FROM statuses
       WHERE user_id = u.id AND expires_at > now()
         AND (u.id = $1 OR visibility = 'public' OR EXISTS (
           SELECT 1 FROM friendships f
           WHERE (f.user_a_id = $1 AND f.user_b_id = u.id) OR (f.user_b_id = $1 AND f.user_a_id = u.id)
         ))
       ORDER BY created_at DESC
       LIMIT 1
     ) s ON true
     WHERE POSITION($2 IN u.em_handle) > 0
       AND NOT EXISTS (
         SELECT 1 FROM blocks b
         WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
            OR (b.blocker_id = u.id AND b.blocked_id = $1)
       )
     ORDER BY
       CASE
         WHEN u.em_handle = $2 THEN 0
         WHEN LEFT(u.em_handle, char_length($2)) = $2 THEN 1
         ELSE 2
       END,
       u.em_handle ASC
     LIMIT 20`,
    [viewerId, emHandleQuery]
  );
  return rows.map((row) => ({ ...row, emHandle: displayEmHandle(row.emHandle) }));
}

function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function areFriends(db: Db, userId: string, otherUserId: string): Promise<boolean> {
  const [a, b] = orderedPair(userId, otherUserId);
  const row = await queryOne(db, "SELECT 1 FROM friendships WHERE user_a_id = $1 AND user_b_id = $2", [a, b]);
  return Boolean(row);
}

async function assertNotBlocked(db: Db, userId: string, otherUserId: string): Promise<void> {
  const row = await queryOne(
    db,
    `SELECT 1 FROM blocks
     WHERE (blocker_id = $1 AND blocked_id = $2)
        OR (blocker_id = $2 AND blocked_id = $1)`,
    [userId, otherUserId]
  );
  if (row) {
    throw new HttpError(403, "차단 관계에서는 이 작업을 할 수 없습니다.");
  }
}

async function assertConversationMember(db: Db, conversationId: string, userId: string): Promise<void> {
  const row = await queryOne(
    db,
    "SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL",
    [conversationId, userId]
  );
  if (!row) {
    throw new HttpError(403, "대화방 접근 권한이 없습니다.");
  }
}

async function createNotification(
  db: Db,
  config: AppConfig,
  runtime: Runtime,
  userId: string,
  input: { kind: string; title: string; body: string; linkPath: string }
): Promise<void> {
  const notification = await queryOne(
    db,
    `INSERT INTO notifications (user_id, kind, title, body, link_path)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, kind, title, body, link_path AS "linkPath", read_at::text AS "readAt", created_at::text AS "createdAt"`,
    [userId, input.kind, input.title, input.body, input.linkPath]
  );
  runtime.realtime?.emitToUser(userId, "notification:new", notification);
  await sendWebPush(db, config, userId, {
    title: input.title,
    body: input.body,
    url: input.linkPath
  });
}
