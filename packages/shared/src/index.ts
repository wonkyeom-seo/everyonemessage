import { z } from "zod";

export const EM_HANDLE_MIN_LENGTH = 3;
export const EM_HANDLE_MAX_LENGTH = 24;
export const EM_HANDLE_PATTERN = /^[a-z0-9._-]{3,24}$/;
export const DISPLAY_EM_HANDLE_PATTERN = /^#[a-z0-9._-]{3,24}$/;

export function normalizeEmHandle(input: string): string {
  return input.trim().replace(/^#/, "").toLowerCase();
}

export function displayEmHandle(handle: string): string {
  return `#${normalizeEmHandle(handle)}`;
}

export function isValidEmHandle(input: string): boolean {
  return EM_HANDLE_PATTERN.test(normalizeEmHandle(input));
}

export const emHandleSchema = z
  .string()
  .trim()
  .transform(normalizeEmHandle)
  .pipe(
    z
      .string()
      .min(EM_HANDLE_MIN_LENGTH)
      .max(EM_HANDLE_MAX_LENGTH)
      .regex(EM_HANDLE_PATTERN, "em아이디는 a-z, 0-9, _, -, . 만 사용할 수 있습니다.")
  );

export const firebaseUidSchema = z.string().min(1).max(128);
export const emailSchema = z.string().trim().email().max(320);
export const nameSchema = z.string().trim().min(1).max(40);
export const profileBioSchema = z.string().trim().max(120).optional();
export const statusTextSchema = z.string().trim().min(1).max(80);
export const messageTextSchema = z.string().trim().min(1).max(4000);
export const conversationNameSchema = z.string().trim().min(1).max(60);

export const statusVisibilitySchema = z.enum(["friends", "public"]);
export type StatusVisibility = z.infer<typeof statusVisibilitySchema>;

export const friendRequestStateSchema = z.enum(["pending", "accepted", "declined", "cancelled"]);
export type FriendRequestState = z.infer<typeof friendRequestStateSchema>;

export const conversationKindSchema = z.enum(["direct", "group"]);
export type ConversationKind = z.infer<typeof conversationKindSchema>;

export const messageKindSchema = z.enum(["text", "image", "file", "system"]);
export type MessageKind = z.infer<typeof messageKindSchema>;

export const notificationKindSchema = z.enum([
  "friend_request",
  "friend_accept",
  "group_invite",
  "message",
  "report_update",
  "security"
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const attachmentSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["image", "file"]),
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  size: z.number().int().nonnegative(),
  url: z.string().url()
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const onboardingSchema = z.object({
  name: nameSchema,
  emHandle: emHandleSchema
});

export const updateProfileSchema = z.object({
  name: nameSchema.optional(),
  avatarUrl: z.string().url().nullable().optional(),
  bio: profileBioSchema
});

export const createStatusSchema = z.object({
  text: statusTextSchema,
  visibility: statusVisibilitySchema.default("friends")
});

export const createFriendRequestSchema = z.object({
  targetUserId: z.string().uuid()
});

export const createDirectConversationSchema = z.object({
  friendUserId: z.string().uuid()
});

export const createGroupConversationSchema = z.object({
  name: conversationNameSchema,
  memberUserIds: z.array(z.string().uuid()).min(1).max(50)
});

export const createMessageSchema = z.object({
  clientId: z.string().min(1).max(100).optional(),
  kind: messageKindSchema.default("text"),
  text: messageTextSchema.optional(),
  attachments: z.array(attachmentSchema).max(10).default([])
});

export const updateMessageSchema = z.object({
  text: messageTextSchema
});

export const createReportSchema = z.object({
  targetType: z.enum(["user", "message", "conversation"]),
  targetId: z.string().min(1).max(128),
  reason: z.string().trim().min(1).max(80),
  details: z.string().trim().max(1000).optional()
});

export interface PublicUser {
  id: string;
  name: string;
  emHandle: string;
  avatarUrl: string | null;
  statusText: string | null;
  statusVisibility: StatusVisibility | null;
}

export interface SearchUserResult extends PublicUser {
  relation: "self" | "friend" | "request_sent" | "request_received" | "none";
  previousHandleNotice?: {
    previousHandle: string;
    currentHandle: string;
    protectedUntil: string;
  };
}

export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  title: string;
  avatarUrl: string | null;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  memberCount: number;
}

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  linkPath: string | null;
}

export function extractHttpUrls(input: string): string[] {
  const urls = input.match(/https?:\/\/[^\s<>"']+/gi);
  return Array.from(new Set(urls ?? [])).slice(0, 5);
}
