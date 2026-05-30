import pg from "pg";
import type { AppConfig } from "./config";

const { Pool } = pg;

export type Db = pg.Pool;

export function createDb(config: AppConfig): Db {
  return new Pool({ connectionString: config.DATABASE_URL });
}

export async function queryOne<T extends pg.QueryResultRow>(
  db: Db,
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const result = await db.query<T>(text, params);
  return result.rows[0] ?? null;
}

export async function queryMany<T extends pg.QueryResultRow>(
  db: Db,
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await db.query<T>(text, params);
  return result.rows;
}

export async function runMigrations(db: Db): Promise<void> {
  await db.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      firebase_uid text UNIQUE NOT NULL,
      email text NOT NULL,
      email_verified boolean NOT NULL DEFAULT false,
      name text,
      em_handle text UNIQUE,
      avatar_url text,
      bio text,
      onboarded_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS em_handle_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      handle text UNIQUE NOT NULL,
      replaced_by_handle text NOT NULL,
      protected_until timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS statuses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text text NOT NULL,
      visibility text NOT NULL CHECK (visibility IN ('friends', 'public')),
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      state text NOT NULL CHECK (state IN ('pending', 'accepted', 'declined', 'cancelled')) DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      responded_at timestamptz,
      UNIQUE (requester_id, addressee_id),
      CHECK (requester_id <> addressee_id)
    );

    CREATE TABLE IF NOT EXISTS friendships (
      user_a_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_a_id, user_b_id),
      CHECK (user_a_id < user_b_id)
    );

    CREATE TABLE IF NOT EXISTS blocks (
      blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (blocker_id, blocked_id),
      CHECK (blocker_id <> blocked_id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL CHECK (kind IN ('direct', 'group')),
      title text,
      avatar_url text,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role text NOT NULL CHECK (role IN ('owner', 'member')) DEFAULT 'member',
      joined_at timestamptz NOT NULL DEFAULT now(),
      left_at timestamptz,
      muted_until timestamptz,
      last_read_message_id uuid,
      last_read_at timestamptz,
      PRIMARY KEY (conversation_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS direct_conversations (
      conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      user_a_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE (user_a_id, user_b_id),
      CHECK (user_a_id < user_b_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id uuid REFERENCES users(id) ON DELETE SET NULL,
      kind text NOT NULL CHECK (kind IN ('text', 'image', 'file', 'system')) DEFAULT 'text',
      text text,
      attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
      link_previews jsonb NOT NULL DEFAULT '[]'::jsonb,
      client_id text,
      edited_at timestamptz,
      deleted_for_all_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (conversation_id, sender_id, client_id)
    );

    CREATE TABLE IF NOT EXISTS message_deletions (
      message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deleted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL,
      title text NOT NULL,
      body text NOT NULL,
      link_path text,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type text NOT NULL CHECK (target_type IN ('user', 'message', 'conversation')),
      target_id text NOT NULL,
      reason text NOT NULL,
      details text,
      snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
      state text NOT NULL DEFAULT 'open',
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint text UNIQUE NOT NULL,
      p256dh text NOT NULL,
      auth text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_users_em_handle ON users (em_handle);
    CREATE INDEX IF NOT EXISTS idx_statuses_active ON statuses (user_id, expires_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages (conversation_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);
  `);
}
