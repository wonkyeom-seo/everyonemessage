import {
  Bell,
  BellRing,
  Camera,
  ChevronLeft,
  Download,
  FileUp,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Search,
  Send,
  Settings,
  Shield,
  Sparkles,
  UserPlus,
  Users
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { displayEmHandle, normalizeEmHandle } from "@em/shared";
import { ApiClient, ApiError } from "./api";
import {
  auth,
  firebaseLogin,
  firebaseLogout,
  firebaseRegister,
  firebaseResetPassword,
  hasFirebaseConfig
} from "./firebase";
import type {
  ConversationSummary,
  Friend,
  FriendRequest,
  Me,
  Message,
  NotificationItem,
  Recommendation,
  SearchResult
} from "./types";

interface SessionUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  mode: "firebase" | "dev";
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api";
const socketPath = import.meta.env.VITE_SOCKET_PATH || "/socket.io";

export function App() {
  const [session, setSession] = useState<SessionUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [appInstalled, setAppInstalled] = useState(
    window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  );

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setAppInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (auth) {
      return auth.onAuthStateChanged((user) => {
        setSession(
          user
            ? {
                uid: user.uid,
                email: user.email ?? "",
                emailVerified: user.emailVerified,
                mode: "firebase"
              }
            : null
        );
        setBooting(false);
      });
    }
    const devSession = localStorage.getItem("em.devSession");
    setSession(devSession ? JSON.parse(devSession) : null);
    setBooting(false);
  }, []);

  const getToken = useCallback(async () => {
    if (!session) return null;
    if (session.mode === "dev") {
      return `dev:${session.uid}:${session.email}`;
    }
    return auth?.currentUser?.getIdToken() ?? null;
  }, [session]);

  const api = useMemo(() => new ApiClient(apiBaseUrl, getToken), [getToken]);

  const refreshMe = useCallback(async () => {
    if (!session || !session.emailVerified) {
      setMe(null);
      return;
    }
    setProfileLoading(true);
    try {
      const response = await api.get<{ user: Me }>("/me");
      setMe(response.user);
    } finally {
      setProfileLoading(false);
    }
  }, [api, session]);

  useEffect(() => {
    refreshMe().catch(() => setMe(null));
  }, [refreshMe]);

  useEffect(() => {
    if (!session || !me?.onboarded) {
      socket?.disconnect();
      setSocket(null);
      return;
    }
    let mounted = true;
    getToken().then((token) => {
      if (!mounted || !token) return;
      const nextSocket = io({
        path: socketPath,
        auth: { token },
        transports: ["websocket", "polling"]
      });
      setSocket(nextSocket);
    });
    return () => {
      mounted = false;
      setSocket((current) => {
        current?.disconnect();
        return null;
      });
    };
  }, [getToken, me?.onboarded, session]);

  const logout = useCallback(async () => {
    localStorage.removeItem("em.devSession");
    await firebaseLogout();
    setSession(null);
    setMe(null);
  }, []);

  const devLogin = useCallback((email: string) => {
    const next = {
      uid: `dev-${email.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
      email,
      emailVerified: true,
      mode: "dev" as const
    };
    localStorage.setItem("em.devSession", JSON.stringify(next));
    setSession(next);
  }, []);

  const installPwa = useCallback(async () => {
    if (!installPrompt) {
      return false;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstallPrompt(null);
      setAppInstalled(true);
      return true;
    }
    return false;
  }, [installPrompt]);

  if (booting) return <Splash />;
  if (!session) return <AuthScreen onDevLogin={devLogin} />;
  if (!session.emailVerified) return <VerifyEmailScreen email={session.email} onLogout={logout} />;
  if (profileLoading) return <Splash />;
  if (!me?.onboarded) return <OnboardingScreen api={api} email={session.email} onDone={refreshMe} onLogout={logout} />;

  return (
    <AppShell
      api={api}
      me={me}
      socket={socket}
      appInstalled={appInstalled}
      canInstallPwa={Boolean(installPrompt)}
      onInstallPwa={installPwa}
      onLogout={logout}
      onMeChange={setMe}
    />
  );
}

function Splash() {
  return (
    <div className="splash">
      <div className="brand-mark">em</div>
    </div>
  );
}

function AuthScreen({ onDevLogin }: { onDevLogin: (email: string) => void }) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setMessage("");
    try {
      if (!hasFirebaseConfig) {
        onDevLogin(email || "dev@example.com");
        return;
      }
      if (mode === "login") await firebaseLogin(email, password);
      if (mode === "register") {
        await firebaseRegister(email, password);
        setMessage("인증 메일을 보냈습니다. 이메일 인증 후 로그인됩니다.");
      }
      if (mode === "reset") {
        await firebaseResetPassword(email);
        setMessage("비밀번호 재설정 메일을 보냈습니다.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-panel">
        <div className="auth-brand">
          <div className="brand-mark">em</div>
          <div>
            <h1>EveryoneMessage</h1>
            <p>em아이디로 친구를 찾고 빠르게 대화하세요.</p>
          </div>
        </div>

        <div className="segmented">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            로그인
          </button>
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
            가입
          </button>
          <button className={mode === "reset" ? "active" : ""} onClick={() => setMode("reset")}>
            재설정
          </button>
        </div>

        <label className="field">
          <span>이메일</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        {mode !== "reset" && (
          <label className="field">
            <span>비밀번호</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
        )}
        <button className="primary-button" disabled={busy || !email || (mode !== "reset" && !password)} onClick={submit}>
          {mode === "login" ? "로그인" : mode === "register" ? "회원가입" : "메일 보내기"}
        </button>
        {!hasFirebaseConfig && (
          <p className="hint">Firebase 설정 전이라 개발 로그인으로 들어갑니다. API는 `AUTH_MODE=dev`가 필요합니다.</p>
        )}
        {message && <p className="notice">{message}</p>}
      </section>
    </div>
  );
}

function VerifyEmailScreen({ email, onLogout }: { email: string; onLogout: () => void }) {
  return (
    <div className="auth-page">
      <section className="auth-panel compact">
        <BellRing size={32} />
        <h1>이메일 인증이 필요합니다</h1>
        <p>{email}로 보낸 Firebase 인증 메일을 확인한 뒤 다시 로그인해주세요.</p>
        <button className="primary-button" onClick={() => window.location.reload()}>
          인증 후 새로 확인
        </button>
        <button className="ghost-button" onClick={onLogout}>
          다른 계정으로 로그인
        </button>
      </section>
    </div>
  );
}

function OnboardingScreen({
  api,
  email,
  onDone,
  onLogout
}: {
  api: ApiClient;
  email: string;
  onDone: () => Promise<void>;
  onLogout: () => void;
}) {
  const [name, setName] = useState("");
  const [emHandle, setEmHandle] = useState("");
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    try {
      await api.post("/me/onboarding", { name, emHandle: displayEmHandle(emHandle) });
      await onDone();
    } catch (error) {
      setError(getErrorMessage(error));
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-panel">
        <div className="auth-brand">
          <div className="brand-mark">em</div>
          <div>
            <h1>프로필 설정</h1>
            <p>{email}</p>
          </div>
        </div>
        <label className="field">
          <span>이름</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>em아이디</span>
          <div className="handle-input">
            <span>#</span>
            <input placeholder="em_id-123" maxLength={12} value={emHandle} onChange={(event) => setEmHandle(cleanHandleInput(event.target.value))} />
          </div>
        </label>
        <p className="hint compact">3-12자, a-z / 0-9 / - / _ 만 사용할 수 있습니다.</p>
        <button className="primary-button" disabled={!name || emHandle.length < 3} onClick={submit}>
          시작하기
        </button>
        {error && <p className="notice error">{error}</p>}
        <button className="ghost-button" onClick={onLogout}>
          로그아웃
        </button>
      </section>
    </div>
  );
}

function AppShell({
  api,
  me,
  socket,
  appInstalled,
  canInstallPwa,
  onInstallPwa,
  onLogout,
  onMeChange
}: {
  api: ApiClient;
  me: Me;
  socket: Socket | null;
  appInstalled: boolean;
  canInstallPwa: boolean;
  onInstallPwa: () => Promise<boolean>;
  onLogout: () => void;
  onMeChange: (me: Me) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const isChatOpen = location.pathname.startsWith("/chats/");

  return (
    <div className={`app-shell ${isChatOpen ? "detail-open" : ""}`}>
      <nav className="app-nav" aria-label="주요 메뉴">
        <NavItem to="/chats" label="채팅" icon={<MessageCircle size={21} />} />
        <NavItem to="/friends" label="친구" icon={<Users size={21} />} />
        <NavItem to="/discover" label="찾기" icon={<Search size={21} />} />
        <NavItem to="/notifications" label="알림" icon={<Bell size={21} />} />
        <NavItem to="/me" label="내정보" icon={<Settings size={21} />} />
      </nav>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/chats" replace />} />
          <Route path="/chats" element={<ChatScreen api={api} me={me} socket={socket} />} />
          <Route path="/chats/:conversationId" element={<ChatScreen api={api} me={me} socket={socket} />} />
          <Route path="/friends" element={<FriendsScreen api={api} me={me} />} />
          <Route path="/discover" element={<DiscoverScreen api={api} me={me} />} />
          <Route path="/notifications" element={<NotificationsScreen api={api} />} />
          <Route
            path="/me"
            element={
              <ProfileScreen
                api={api}
                me={me}
                appInstalled={appInstalled}
                canInstallPwa={canInstallPwa}
                onInstallPwa={onInstallPwa}
                onLogout={onLogout}
                onMeChange={onMeChange}
              />
            }
          />
          <Route path="*" element={<Navigate to="/chats" replace />} />
        </Routes>
      </main>
      {!appInstalled && (
        <button
          className={`install-fab ${canInstallPwa ? "" : "muted-install"}`}
          onClick={async () => {
            const accepted = await onInstallPwa();
            if (!accepted && !canInstallPwa) navigate("/me");
          }}
        >
          <Download size={18} />
          <span>앱 설치</span>
        </button>
      )}
    </div>
  );
}

function NavItem({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <NavLink to={to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}

function ChatScreen({ api, me, socket }: { api: ApiClient; me: Me; socket: Socket | null }) {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<{ conversations: ConversationSummary[] }>("/conversations");
      setConversations(response.conversations);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!socket) return;
    const reload = () => load().catch(() => undefined);
    socket.on("message:new", reload);
    socket.on("message:delete", reload);
    return () => {
      socket.off("message:new", reload);
      socket.off("message:delete", reload);
    };
  }, [load, socket]);

  const startSelfChat = async () => {
    setNotice("");
    try {
      const response = await api.post<{ conversationId: string }>("/conversations/self");
      navigate(`/chats/${response.conversationId}`);
    } catch (error) {
      setNotice(getErrorMessage(error));
    }
  };

  return (
    <section className="split-view">
      <aside className={`list-pane ${conversationId ? "mobile-hidden" : ""}`}>
        <Header
          title="채팅"
          action={
            <span className="header-actions">
              <button className="icon-button text-icon-button" onClick={startSelfChat} title="나와의 채팅">
                <MessageCircle size={17} />
                <span>나</span>
              </button>
              <LinkButton to="/friends" icon={<UserPlus size={18} />} label="새 채팅" />
            </span>
          }
        />
        <div className="search-row">
          <Search size={17} />
          <input placeholder="대화 검색" />
        </div>
        {notice && <p className="notice error">{notice}</p>}
        <div className="list-stack">
          <button className="list-row self-row" onClick={startSelfChat}>
            <Avatar name="나" src={me.avatarUrl} />
            <span className="row-main">
              <strong>나와의 채팅</strong>
              <small>메모와 파일을 나에게 보내기</small>
            </span>
          </button>
          {loading && <SkeletonRows />}
          {!loading && conversations.length === 0 && <EmptyState title="아직 대화가 없습니다" body="친구 탭에서 친구에게 메시지를 시작하거나 나와의 채팅을 열어보세요." />}
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              className={`list-row ${conversation.id === conversationId ? "selected" : ""}`}
              onClick={() => navigate(`/chats/${conversation.id}`)}
            >
              <Avatar name={conversation.title} src={conversation.avatarUrl} />
              <span className="row-main">
                <strong>{conversation.title}</strong>
                <small>{conversation.lastMessageText || `${conversation.memberCount}명`}</small>
              </span>
              {conversation.unreadCount > 0 && <span className="badge">{conversation.unreadCount}</span>}
            </button>
          ))}
        </div>
      </aside>
      <ConversationPane api={api} me={me} socket={socket} conversationId={conversationId} />
    </section>
  );
}

function ConversationPane({
  api,
  me,
  socket,
  conversationId
}: {
  api: ApiClient;
  me: Me;
  socket: Socket | null;
  conversationId?: string;
}) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [actionMessageId, setActionMessageId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const loadMessages = useCallback(async (markRead = true) => {
    if (!conversationId) return;
    const response = await api.get<{ messages: Message[] }>(`/conversations/${conversationId}/messages`);
    setMessages(response.messages);
    if (markRead) {
      await api.post(`/conversations/${conversationId}/read`);
    }
  }, [api, conversationId]);

  useEffect(() => {
    loadMessages().catch(() => undefined);
  }, [loadMessages]);

  useEffect(() => {
    if (!socket || !conversationId) return;
    socket.emit("conversation:join", conversationId);
    const onNew = (message: Message) => {
      if (message.conversationId === conversationId) {
        setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]));
        if (message.senderId !== me.id) {
          api.post(`/conversations/${conversationId}/read`).catch(() => undefined);
        }
      }
    };
    const onEdit = (payload: { id: string; text: string }) => {
      setMessages((current) => current.map((message) => (message.id === payload.id ? { ...message, text: payload.text, editedAt: new Date().toISOString() } : message)));
    };
    const onDelete = (payload: { id: string }) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === payload.id ? { ...message, text: null, attachments: [], linkPreviews: [], deletedForAllAt: new Date().toISOString() } : message
        )
      );
    };
    const onRead = (payload: { conversationId: string; userId: string; readAt: string }) => {
      if (payload.conversationId === conversationId && payload.userId !== me.id) {
        loadMessages(false).catch(() => undefined);
      }
    };
    socket.on("message:new", onNew);
    socket.on("message:edit", onEdit);
    socket.on("message:delete", onDelete);
    socket.on("message:read", onRead);
    return () => {
      socket.off("message:new", onNew);
      socket.off("message:edit", onEdit);
      socket.off("message:delete", onDelete);
      socket.off("message:read", onRead);
    };
  }, [api, conversationId, loadMessages, me.id, socket]);

  useEffect(() => {
    const closeActions = () => setActionMessageId(null);
    window.addEventListener("click", closeActions);
    return () => window.removeEventListener("click", closeActions);
  }, []);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const openMessageActions = (message: Message) => {
    if (message.senderId !== me.id || message.deletedForAllAt) return;
    setActionMessageId((current) => (current === message.id ? null : message.id));
  };

  const startLongPress = (event: React.PointerEvent, message: Message) => {
    if (event.pointerType !== "touch" || message.senderId !== me.id || message.deletedForAllAt) return;
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      setActionMessageId(message.id);
      longPressTimerRef.current = null;
    }, 520);
  };

  const editMessage = async (message: Message) => {
    setActionMessageId(null);
    const next = window.prompt("메시지 수정", message.text ?? "");
    if (next && next.trim()) {
      await api.patch(`/messages/${message.id}`, { text: next });
    }
  };

  const deleteMessage = async (message: Message) => {
    setActionMessageId(null);
    await api.delete(`/messages/${message.id}?scope=all`);
    await loadMessages(false);
  };

  const sendText = async () => {
    if (!conversationId || !text.trim()) return;
    const draft = text;
    setText("");
    await api.post<{ message: Message }>(`/conversations/${conversationId}/messages`, {
      clientId: crypto.randomUUID(),
      kind: "text",
      text: draft,
      attachments: []
    });
  };

  const uploadFile = async (file: File) => {
    if (!conversationId) return;
    setBusy(true);
    try {
      const presign = await api.post<{ uploadUrl: string; publicUrl: string; key: string }>("/uploads/presign", {
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size
      });
      const uploadResponse = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file
      });
      if (!uploadResponse.ok) {
        throw new ApiError(uploadResponse.status, "파일 업로드에 실패했습니다.");
      }
      const kind = file.type.startsWith("image/") ? "image" : "file";
      await api.post(`/conversations/${conversationId}/messages`, {
        clientId: crypto.randomUUID(),
        kind,
        attachments: [
          {
            id: presign.key,
            kind,
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            url: presign.publicUrl
          }
        ]
      });
    } finally {
      setBusy(false);
    }
  };

  if (!conversationId) {
    return (
      <section className="detail-pane empty-detail">
        <MessageCircle size={42} />
        <h2>대화를 선택하세요</h2>
      </section>
    );
  }

  return (
    <section className="detail-pane chat-pane">
      <header className="chat-header">
        <button className="icon-button back-button" onClick={() => navigate("/chats")}>
          <ChevronLeft size={22} />
        </button>
        <div>
          <strong>대화</strong>
          <small>실시간 연결 {socket?.connected ? "온라인" : "대기 중"}</small>
        </div>
        <button className="icon-button">
          <MoreHorizontal size={20} />
        </button>
      </header>
      <div className="message-list">
        {messages.map((message) => {
          const mine = message.senderId === me.id;
          return (
            <article
              key={message.id}
              className={`message ${mine ? "mine" : ""}`}
              onContextMenu={(event) => {
                if (mine && !message.deletedForAllAt) {
                  event.preventDefault();
                  event.stopPropagation();
                  openMessageActions(message);
                }
              }}
              onPointerDown={(event) => startLongPress(event, message)}
              onPointerUp={clearLongPress}
              onPointerCancel={clearLongPress}
              onPointerMove={clearLongPress}
            >
              {!mine && <small className="sender-name">{message.senderName}</small>}
              <div className="bubble">
                {message.deletedForAllAt ? (
                  <span className="muted">삭제된 메시지입니다.</span>
                ) : (
                  <>
                    {message.text && <p>{message.text}</p>}
                    {message.attachments.map((attachment) =>
                      attachment.kind === "image" ? (
                        <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer">
                          <img className="message-image" src={attachment.url} alt={attachment.name} />
                        </a>
                      ) : (
                        <a key={attachment.id} className="file-chip" href={attachment.url} target="_blank" rel="noreferrer">
                          <FileUp size={16} />
                          {attachment.name}
                        </a>
                      )
                    )}
                    {message.linkPreviews.map((preview) => (
                      <a key={preview.url} className="link-preview" href={preview.url} target="_blank" rel="noreferrer">
                        <strong>{preview.title || preview.domain}</strong>
                        <span>{preview.url}</span>
                      </a>
                    ))}
                    {message.editedAt && <small className="edited">수정됨</small>}
                  </>
                )}
              </div>
              <div className="message-meta">
                <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
                {mine && !message.deletedForAllAt && <span className="read-receipt">{readReceiptLabel(message)}</span>}
              </div>
              {mine && !message.deletedForAllAt && actionMessageId === message.id && (
                <div className="message-action-menu" onClick={(event) => event.stopPropagation()}>
                  <button onClick={() => editMessage(message)}>수정</button>
                  <button onClick={() => deleteMessage(message)}>삭제</button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <footer className="composer">
        <input
          ref={fileInputRef}
          hidden
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) uploadFile(file).catch(() => undefined);
            event.currentTarget.value = "";
          }}
        />
        <button className="icon-button" disabled={busy} onClick={() => fileInputRef.current?.click()}>
          <FileUp size={20} />
        </button>
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="메시지 입력" rows={1} />
        <button className="send-button" onClick={sendText} disabled={!text.trim()}>
          <Send size={18} />
        </button>
      </footer>
    </section>
  );
}

function FriendsScreen({ api, me }: { api: ApiClient; me: Me }) {
  const navigate = useNavigate();
  const location = useLocation();
  const requestSectionRef = useRef<HTMLDivElement | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [selected, setSelected] = useState<Friend | null>(null);
  const [groupMode, setGroupMode] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const focus = new URLSearchParams(location.search).get("focus");
  const focusedRequestId = new URLSearchParams(location.search).get("requestId");

  const load = useCallback(async () => {
    const [friendResponse, requestResponse] = await Promise.all([
      api.get<{ friends: Friend[] }>("/friends"),
      api.get<{ requests: FriendRequest[] }>("/friends/requests")
    ]);
    const normalizedFriends = friendResponse.friends.map(normalizeFriend);
    setFriends(normalizedFriends);
    setRequests(requestResponse.requests);
    setSelected((current) => {
      if (!current) return null;
      if (current.id === me.id) {
        return { id: me.id, name: me.name ?? "나", emHandle: me.emHandle ?? "", avatarUrl: me.avatarUrl, statusText: null };
      }
      return normalizedFriends.find((friend) => friend.id === current.id) ?? null;
    });
  }, [api, me.avatarUrl, me.emHandle, me.id, me.name]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (focus === "requests") {
      setSelected(null);
      requestSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [focus, requests.length]);

  const startDirect = async (friend: Friend) => {
    const response = await api.post<{ conversationId: string }>("/conversations/direct", { friendUserId: friend.id });
    navigate(`/chats/${response.conversationId}`);
  };

  const acceptRequest = async (id: string) => {
    await api.post(`/friends/requests/${id}/accept`);
    await load();
  };

  const declineRequest = async (id: string) => {
    await api.post(`/friends/requests/${id}/decline`);
    await load();
  };

  const createGroup = async () => {
    const response = await api.post<{ conversationId: string }>("/conversations/group", {
      name: groupName,
      memberUserIds: Array.from(checked)
    });
    navigate(`/chats/${response.conversationId}`);
  };

  return (
    <section className="split-view">
      <aside className={`list-pane ${selected ? "mobile-hidden-when-detail" : ""}`}>
        <Header
          title="친구"
          action={
            <button className="icon-button" onClick={() => setGroupMode((value) => !value)}>
              <Users size={19} />
            </button>
          }
        />
        <button className="list-row self-row" onClick={() => setSelected({ id: me.id, name: me.name ?? "나", emHandle: me.emHandle ?? "", avatarUrl: me.avatarUrl, statusText: null })}>
          <Avatar name={me.name ?? "나"} src={me.avatarUrl} />
          <span className="row-main">
            <strong>{me.name}</strong>
            <small>{me.emHandle}</small>
          </span>
        </button>
        <div ref={requestSectionRef} id="friend-requests" className="section-block friend-requests-block">
          <h2>친구 요청</h2>
          {requests.length === 0 && <p className="muted">처리할 요청이 없습니다.</p>}
          {requests.map((request) => {
            const incoming = request.addresseeId === me.id;
            return (
              <article key={request.id} className={`request-row ${request.id === focusedRequestId ? "highlight" : ""}`}>
                <span>
                  <strong>{incoming ? request.requesterName : request.addresseeName}</strong>
                  <small>{ensureDisplayHandle(incoming ? request.requesterEmHandle : request.addresseeEmHandle)}</small>
                </span>
                {incoming ? (
                  <span className="button-row">
                    <button onClick={() => acceptRequest(request.id)}>수락</button>
                    <button onClick={() => declineRequest(request.id)}>거절</button>
                  </span>
                ) : (
                  <small className="muted">대기 중</small>
                )}
              </article>
            );
          })}
        </div>
        {groupMode && (
          <div className="inline-form">
            <input placeholder="그룹 이름" value={groupName} onChange={(event) => setGroupName(event.target.value)} />
            <button className="primary-button" disabled={!groupName || checked.size === 0} onClick={createGroup}>
              그룹 만들기
            </button>
          </div>
        )}
        <div className="list-stack">
          {friends.map((friend) => (
            <button key={friend.id} className={`list-row ${selected?.id === friend.id ? "selected" : ""}`} onClick={() => setSelected(friend)}>
              {groupMode && (
                <input
                  type="checkbox"
                  checked={checked.has(friend.id)}
                  onChange={(event) => {
                    event.stopPropagation();
                    setChecked((current) => {
                      const next = new Set(current);
                      next.has(friend.id) ? next.delete(friend.id) : next.add(friend.id);
                      return next;
                    });
                  }}
                />
              )}
              <Avatar name={friend.name} src={friend.avatarUrl} />
              <span className="row-main">
                <strong>
                  {friend.name}
                  {friend.statusText && <em>{friend.statusText}</em>}
                </strong>
                <small>{ensureDisplayHandle(friend.emHandle)}</small>
              </span>
            </button>
          ))}
          {friends.length === 0 && <EmptyState title="친구가 없습니다" body="찾기 탭에서 em아이디로 친구를 추가하세요." />}
        </div>
      </aside>
      <section className="detail-pane profile-detail">
        {selected ? (
          <>
            <button className="icon-button back-button" onClick={() => setSelected(null)}>
              <ChevronLeft size={22} />
            </button>
            <Avatar name={selected.name} src={selected.avatarUrl} large />
            <h2>{selected.name}</h2>
            <p>{ensureDisplayHandle(selected.emHandle)}</p>
            {selected.statusText && <span className="status-pill">{selected.statusText}</span>}
            {selected.id !== me.id && (
              <button className="primary-button" onClick={() => startDirect(selected)}>
                <MessageCircle size={18} />
                메시지
              </button>
            )}
          </>
        ) : (
          <EmptyState title="친구를 선택하세요" body="가로 화면에서는 여기에 프로필이 표시됩니다." />
        )}
      </section>
    </section>
  );
}

function DiscoverScreen({ api, me }: { api: ApiClient; me: Me }) {
  const location = useLocation();
  const requestSectionRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [message, setMessage] = useState("");
  const focus = new URLSearchParams(location.search).get("focus");
  const focusedRequestId = new URLSearchParams(location.search).get("requestId");

  const load = useCallback(async () => {
    const [requestResponse, recommendationResponse] = await Promise.all([
      api.get<{ requests: FriendRequest[] }>("/friends/requests"),
      api.get<{ recommendations: Recommendation[] }>("/friends/recommendations")
    ]);
    setRequests(requestResponse.requests);
    setRecommendations(recommendationResponse.recommendations.map((item) => ({ ...item, emHandle: ensureDisplayHandle(item.emHandle) })));
  }, [api]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (focus === "requests") {
      requestSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [focus, requests.length]);

  const search = async () => {
    setMessage("");
    if (!query) return;
    const response = await api.get<{ result: SearchResult | null; results?: SearchResult[] }>(`/users/search?emId=${encodeURIComponent(query)}`);
    const nextResults = (response.results ?? (response.result ? [response.result] : [])).map(normalizeFriend);
    setResults(nextResults);
    if (nextResults.length === 0) {
      setMessage("검색 결과가 없습니다.");
    }
  };

  const requestFriend = async (targetUserId: string) => {
    await api.post("/friends/requests", { targetUserId });
    setMessage("친구 요청을 보냈습니다.");
    setResults((current) => current.map((item) => (item.id === targetUserId ? { ...item, relation: "request_sent" } : item)));
    await load();
  };

  return (
    <section className="split-view discover-view">
      <aside className="list-pane">
        <Header title="찾기" />
        <div className="search-row strong">
          <div className="handle-input search-handle">
            <span>#</span>
            <input
              placeholder="em_id"
              maxLength={12}
              value={query}
              onChange={(event) => setQuery(cleanHandleInput(event.target.value))}
              onKeyDown={(event) => event.key === "Enter" && search()}
            />
          </div>
          <button disabled={!query} onClick={search}>
            검색
          </button>
        </div>
        {message && <p className="notice">{message}</p>}
        <div className="search-results">
          {results.map((result) => (
            <article key={result.id} className="result-panel compact-result">
              {result.previousHandleNotice && (
                <p className="notice">
                  {result.previousHandleNotice.previousHandle}은 현재 {result.previousHandleNotice.currentHandle}로 변경되었습니다.
                </p>
              )}
              <Avatar name={result.name} src={result.avatarUrl} large />
              <h2>{result.name}</h2>
              <p>
                {ensureDisplayHandle(result.emHandle)}
                {result.statusText && <em>{result.statusText}</em>}
              </p>
              {result.relation === "none" && (
                <button className="primary-button" onClick={() => requestFriend(result.id)}>
                  <UserPlus size={18} />
                  친구 요청
                </button>
              )}
              {result.relation === "self" && <span className="status-pill">내 계정</span>}
              {result.relation === "friend" && <span className="status-pill">이미 친구</span>}
              {result.relation === "request_sent" && <span className="status-pill">요청 보냄</span>}
              {result.relation === "request_received" && <span className="status-pill">받은 요청 있음</span>}
            </article>
          ))}
        </div>
        <div ref={requestSectionRef} id="friend-requests" className="section-block friend-requests-block">
          <h2>친구 요청</h2>
          {requests.length === 0 && <p className="muted">처리할 요청이 없습니다.</p>}
          {requests.map((request) => {
            const incoming = request.addresseeId === me.id;
            return (
              <article key={request.id} className={`request-row ${request.id === focusedRequestId ? "highlight" : ""}`}>
                <span>
                  <strong>{incoming ? request.requesterName : request.addresseeName}</strong>
                  <small>{ensureDisplayHandle(incoming ? request.requesterEmHandle : request.addresseeEmHandle)}</small>
                </span>
                {incoming ? (
                  <span className="button-row">
                    <button onClick={() => api.post(`/friends/requests/${request.id}/accept`).then(load)}>수락</button>
                    <button onClick={() => api.post(`/friends/requests/${request.id}/decline`).then(load)}>거절</button>
                  </span>
                ) : (
                  <small className="muted">대기 중</small>
                )}
              </article>
            );
          })}
        </div>
      </aside>
      <section className="detail-pane discover-detail">
        <div className="section-block">
          <h2>친구추천</h2>
          {recommendations.length === 0 && <p className="muted">겹치는 친구가 생기면 추천이 표시됩니다.</p>}
          {recommendations.map((recommendation) => (
            <article key={recommendation.id} className="recommendation-row">
              <Avatar name={recommendation.name} src={recommendation.avatarUrl} />
              <span>
                <strong>
                  {recommendation.name}
                  {recommendation.statusText && <em>{recommendation.statusText}</em>}
                </strong>
                <small>
                  함께 아는 친구 {recommendation.mutualCount}명 {recommendation.mutualNames?.join(", ")}
                </small>
              </span>
              <button onClick={() => requestFriend(recommendation.id)}>요청</button>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function NotificationsScreen({ api }: { api: ApiClient }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationItem[]>([]);

  const load = useCallback(async () => {
    const response = await api.get<{ notifications: NotificationItem[] }>("/notifications");
    setItems(response.notifications);
  }, [api]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  return (
    <section className="single-view">
      <Header title="알림" />
      <div className="list-stack wide">
        {items.map((item) => (
          <button
            key={item.id}
            className={`notification-row ${item.readAt ? "" : "unread"}`}
            onClick={async () => {
              await api.post(`/notifications/${item.id}/read`);
              if (item.kind === "friend_request") navigate(item.linkPath?.startsWith("/friends") ? item.linkPath : "/friends?focus=requests");
              else if (item.linkPath) navigate(item.linkPath);
              else await load();
            }}
          >
            <BellRing size={20} />
            <span>
              <strong>{item.title}</strong>
              <small>{item.body}</small>
            </span>
          </button>
        ))}
        {items.length === 0 && <EmptyState title="알림이 없습니다" body="친구 요청과 그룹 초대가 여기에 표시됩니다." />}
      </div>
    </section>
  );
}

function ProfileScreen({
  api,
  me,
  appInstalled,
  canInstallPwa,
  onInstallPwa,
  onLogout,
  onMeChange
}: {
  api: ApiClient;
  me: Me;
  appInstalled: boolean;
  canInstallPwa: boolean;
  onInstallPwa: () => Promise<boolean>;
  onLogout: () => void;
  onMeChange: (me: Me) => void;
}) {
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(me.name ?? "");
  const [emHandle, setEmHandle] = useState(cleanHandleInput(me.emHandle ?? ""));
  const [statusText, setStatusText] = useState("");
  const [visibility, setVisibility] = useState<"friends" | "public">("friends");
  const [theme, setThemeState] = useState(localStorage.getItem("em.theme") || "light");
  const [message, setMessage] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);

  const saveProfile = async () => {
    const response = await api.patch<{ user: Me }>("/me/profile", { name });
    onMeChange(response.user);
    setMessage("프로필을 저장했습니다.");
  };

  const saveHandle = async () => {
    const response = await api.patch<{ user: Me }>("/me/em-id", { emHandle: displayEmHandle(emHandle) });
    onMeChange(response.user);
    setMessage("em아이디를 변경했습니다. 이전 아이디는 20일간 보호됩니다.");
  };

  const uploadAvatar = async (file: File) => {
    setAvatarBusy(true);
    setMessage("");
    try {
      const response = await api.putRaw<{ user: Me }>("/me/avatar", file, file.type || "application/octet-stream", {
        "X-File-Name": encodeURIComponent(file.name)
      });
      onMeChange(response.user);
      setMessage("프로필 사진을 변경했습니다.");
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setAvatarBusy(false);
    }
  };

  const saveStatus = async () => {
    await api.post("/me/status", { text: statusText, visibility });
    setStatusText("");
    setMessage("24시간 상태메시지를 올렸습니다.");
  };

  const enablePush = async () => {
    const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setMessage("이 브라우저 또는 환경에서는 Web Push 설정이 필요합니다.");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToArrayBuffer(publicKey)
    });
    await api.post("/push/subscriptions", subscription.toJSON());
    setMessage("푸시 알림을 켰습니다.");
  };

  const setTheme = (value: "light" | "dark" | "system") => {
    localStorage.setItem("em.theme", value);
    document.documentElement.dataset.theme = value;
    setThemeState(value);
  };

  const installApp = async () => {
    if (appInstalled) {
      setMessage("이미 설치된 앱으로 실행 중입니다.");
      return;
    }
    const accepted = await onInstallPwa();
    setMessage(accepted ? "앱 설치를 시작했습니다." : "브라우저 메뉴에서 앱 설치 또는 홈 화면에 추가를 선택해주세요.");
  };

  return (
    <section className="single-view profile-view">
      <Header title="내정보" />
      <div className="settings-grid">
        <section className="settings-section">
          <input
            ref={avatarInputRef}
            hidden
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) uploadAvatar(file).catch(() => undefined);
              event.currentTarget.value = "";
            }}
          />
          <Avatar name={me.name ?? "나"} src={me.avatarUrl} large />
          <h2>{me.name}</h2>
          <p>{me.emHandle}</p>
          <button className="ghost-button" disabled={avatarBusy} onClick={() => avatarInputRef.current?.click()}>
            <Camera size={18} />
            프사 바꾸기
          </button>
          <button className="ghost-button pwa-button" onClick={installApp} disabled={appInstalled}>
            <Download size={18} />
            {appInstalled ? "앱 설치됨" : canInstallPwa ? "PWA 앱 설치" : "앱 설치 안내"}
          </button>
          {message && <p className="notice">{message}</p>}
        </section>
        <section className="settings-section">
          <h3>프로필</h3>
          <label className="field">
            <span>이름</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <button className="primary-button" onClick={saveProfile}>
            저장
          </button>
        </section>
        <section className="settings-section">
          <h3>em아이디</h3>
          <label className="field">
            <span>아이디</span>
            <div className="handle-input">
              <span>#</span>
              <input value={emHandle} maxLength={12} onChange={(event) => setEmHandle(cleanHandleInput(event.target.value))} />
            </div>
          </label>
          <button className="primary-button" disabled={emHandle.length < 3} onClick={saveHandle}>
            변경
          </button>
          <p className="hint">3-12자, a-z / 0-9 / - / _ 만 사용할 수 있습니다. 이전 em아이디는 20일 동안 보호됩니다.</p>
        </section>
        <section className="settings-section">
          <h3>상태메시지</h3>
          <label className="field">
            <span>24시간 상태</span>
            <input value={statusText} onChange={(event) => setStatusText(event.target.value)} />
          </label>
          <div className="segmented inline">
            <button className={visibility === "friends" ? "active" : ""} onClick={() => setVisibility("friends")}>
              친구만
            </button>
            <button className={visibility === "public" ? "active" : ""} onClick={() => setVisibility("public")}>
              전체공개
            </button>
          </div>
          <button className="primary-button" disabled={!statusText} onClick={saveStatus}>
            올리기
          </button>
        </section>
        <section className="settings-section">
          <h3>보안</h3>
          <div className="segmented inline">
            <button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>
              라이트
            </button>
            <button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>
              다크
            </button>
          </div>
          <button className="ghost-button" onClick={() => setTheme("system")}>
            <Settings size={18} />
            시스템 테마
          </button>
          <button className="ghost-button" onClick={enablePush}>
            <BellRing size={18} />
            푸시 알림 켜기
          </button>
          <button className="ghost-button">
            <Shield size={18} />
            차단 목록
          </button>
          <button className="ghost-button" onClick={onLogout}>
            <LogOut size={18} />
            로그아웃
          </button>
        </section>
      </div>
    </section>
  );
}

function Header({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <header className="pane-header">
      <h1>{title}</h1>
      {action}
    </header>
  );
}

function LinkButton({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link className="icon-button" to={to} aria-label={label} title={label}>
      {icon}
    </Link>
  );
}

function Avatar({ name, src, large = false }: { name: string; src?: string | null; large?: boolean }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  useEffect(() => {
    setFailedSrc(null);
  }, [src]);
  const initials = name.trim().slice(0, 2) || "em";
  return src && failedSrc !== src ? (
    <img className={`avatar ${large ? "large" : ""}`} src={src} alt="" onError={() => setFailedSrc(src)} />
  ) : (
    <span className={`avatar ${large ? "large" : ""}`}>{initials}</span>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <Sparkles size={24} />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      <div className="skeleton-row" />
      <div className="skeleton-row" />
      <div className="skeleton-row" />
    </>
  );
}

function normalizeFriend<T extends { emHandle: string }>(friend: T): T {
  return { ...friend, emHandle: ensureDisplayHandle(friend.emHandle) };
}

function ensureDisplayHandle(handle: string) {
  return handle.startsWith("#") ? handle : displayEmHandle(handle);
}

function cleanHandleInput(value: string) {
  return normalizeEmHandle(value).replace(/[^a-z0-9_-]/g, "").slice(0, 12);
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function readReceiptLabel(message: Message) {
  const otherMemberCount = Math.max((message.memberCount ?? 1) - 1, 0);
  if (otherMemberCount === 0) {
    return "나만 보기";
  }
  const readByCount = Math.min(message.readByCount ?? 0, otherMemberCount);
  if (otherMemberCount === 1) {
    return readByCount > 0 ? "읽음" : "안읽음";
  }
  return `읽음 ${readByCount}/${otherMemberCount}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "처리하지 못했습니다.";
}

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output.buffer as ArrayBuffer;
}
