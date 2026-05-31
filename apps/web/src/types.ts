export interface Me {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  emHandle: string | null;
  avatarUrl: string | null;
  bio: string | null;
  onboarded: boolean;
}

export interface Friend {
  id: string;
  name: string;
  emHandle: string;
  avatarUrl: string | null;
  statusText: string | null;
  statusVisibility?: string | null;
}

export interface FriendRequest {
  id: string;
  state: string;
  createdAt: string;
  requesterId: string;
  requesterName: string;
  requesterEmHandle: string;
  addresseeId: string;
  addresseeName: string;
  addresseeEmHandle: string;
}

export interface Recommendation extends Friend {
  mutualCount: number;
  mutualNames: string[];
}

export interface SearchResult extends Friend {
  relation: "self" | "friend" | "request_sent" | "request_received" | "none";
  previousHandleNotice?: {
    previousHandle: string;
    currentHandle: string;
    protectedUntil: string;
  };
}

export interface ConversationSummary {
  id: string;
  kind: "direct" | "group";
  title: string;
  avatarUrl: string | null;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  memberCount: number;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string | null;
  senderName?: string | null;
  kind: "text" | "image" | "file" | "system";
  text: string | null;
  attachments: Array<{
    id: string;
    kind: "image" | "file";
    name: string;
    mimeType: string;
    size: number;
    url: string;
  }>;
  linkPreviews: Array<{ url: string; domain: string; title?: string }>;
  editedAt: string | null;
  deletedForAllAt: string | null;
  createdAt: string;
  memberCount: number;
  readByCount: number;
}

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}
