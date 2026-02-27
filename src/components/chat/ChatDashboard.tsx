// src/components/chat/ChatDashboard.tsx
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Plus,
  Settings,
  LogOut,
  Loader2,
  WifiOff,
  RefreshCw,
  DatabaseIcon,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useChatSocket, dmChatId } from "../../hooks/useChatSocket";
import { UserSearch } from "./UserSearch";
import { ChatWindow } from "./ChatWindow";
import {
  getAllContacts,
  upsertContact,
  type DbContact,
} from "../../services/db";
import type { SearchedUser, Conversation, UserStatus } from "../../types/chat";
import { FloatingTabBar } from "../layout/FloatingTabBar";

// ─── Avatar Color ─────────────────────────────────────────────────────────────

function getAvatarColor(username: string): string {
  const colors = [
    "bg-blue-600",
    "bg-violet-600",
    "bg-emerald-600",
    "bg-rose-600",
    "bg-amber-600",
    "bg-cyan-600",
    "bg-pink-600",
    "bg-indigo-600",
  ];
  let hash = 0;
  for (let i = 0; i < username.length; i++)
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ─── Connection Status Badge ──────────────────────────────────────────────────

function ConnectionBadge({
  status,
  onReconnect,
}: {
  status: string;
  onReconnect: () => void;
}) {
  if (status === "connected") return null;
  const config: Record<
    string,
    { label: string; color: string; icon?: React.ReactNode }
  > = {
    connecting: {
      label: "Connecting…",
      color: "bg-amber-500",
      icon: <Loader2 size={15} className="animate-spin" />,
    },
    reconnecting: {
      label: "Reconnecting…",
      color: "bg-amber-500",
      icon: <Loader2 size={15} className="animate-spin" />,
    },
    disconnected: {
      label: "Disconnected",
      color: "bg-red-500",
      icon: <WifiOff size={15} />,
    },
    auth_failed: {
      label: "Auth Failed",
      color: "bg-red-600",
      icon: <WifiOff size={15} />,
    },
    idle: { label: "Not Connected", color: "bg-slate-400" },
  };
  const { label, color, icon } = config[status] ?? config["idle"];
  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-white text-[11px] font-semibold ${color} shadow-sm`}
    >
      {icon}
      {label}
      {status === "disconnected" && (
        <button onClick={onReconnect} className="ml-1 hover:opacity-70">
          <RefreshCw size={11} />
        </button>
      )}
    </div>
  );
}

// ─── Conversation List Item ───────────────────────────────────────────────────

interface ConvItemProps {
  conv: Conversation;
  isActive: boolean;
  myUsername: string;
  onClick: () => void;
}

function ConversationItem({ conv, isActive, onClick }: ConvItemProps) {
  const avatarColor = getAvatarColor(conv.peerUsername);
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-3.5 rounded-2xl transition-all active:scale-[0.98] text-left ${
        isActive
          ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200/50 dark:border-blue-800/30"
          : "hover:bg-slate-50 dark:hover:bg-slate-800/50 border border-transparent"
      }`}
    >
      <div className="relative flex-shrink-0">
        <div
          className={`w-12 h-12 ${avatarColor} rounded-2xl flex items-center justify-center text-white font-bold text-lg shadow`}
        >
          {conv.peerNickname[0].toUpperCase()}
        </div>
        <div
          className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-slate-900 transition-colors ${
            conv.peerStatus === "online" ? "bg-green-500" : "bg-slate-300"
          }`}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline mb-0.5">
          <span className="font-semibold text-[14px] text-slate-800 dark:text-slate-100 truncate">
            {conv.peerNickname}
          </span>
          {conv.lastMessage && (
            <span className="text-[10px] text-slate-400 flex-shrink-0 ml-2">
              {new Date(conv.lastMessage.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-1">
          <p className="text-[12px] text-slate-500 dark:text-slate-400 truncate flex-1">
            {conv.isTyping ? (
              <span className="text-blue-500 italic animate-pulse">
                is whisping…
              </span>
            ) : (
              conv.lastMessage?.text ?? "No messages yet"
            )}
          </p>
          {conv.unreadCount > 0 && (
            <span className="flex-shrink-0 bg-blue-600 text-white text-[10px] font-black min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full shadow-sm">
              {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export function ChatDashboard() {
  const { authUser, logout } = useAuth();

  const {
    connectionStatus,
    messages,
    typingPeers,
    peerStatuses,
    dbLoaded,
    sendMessage,
    emitTypingStart,
    emitTypingStop,
    markAsRead,
    clearChat,
    reconnect,
    error: socketError,
  } = useChatSocket({ token: authUser?.token, myUsername: authUser?.username });

  // ── Contacts — loaded from Dexie (replaces localStorage) ──────────────────
  // Map<username → contact info> acts as the canonical contact list.
  // Initialized empty; populated from Dexie on mount.
  const [contacts, setContacts] = useState<Map<string, DbContact>>(new Map());
  const [contactsLoaded, setContactsLoaded] = useState(false);

  useEffect(() => {
    if (!authUser?.username) return;
    getAllContacts()
      .then((rows) => {
        const map = new Map(rows.map((c) => [c.username, c]));
        setContacts(map);
        setContactsLoaded(true);
        console.info(`[Dashboard] Dexie contacts loaded: ${rows.length}`);
      })
      .catch((err) => {
        console.error("[Dashboard] Failed to load contacts:", err);
        setContactsLoaded(true); // unblock UI
      });
  }, [authUser?.username]);

  // ── UI State ──────────────────────────────────────────────────────────────

  const [activePeer, setActivePeer] = useState<SearchedUser | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);

  // ── Active chat messages ─────────────────────────────────────────────────
  const activeMessages = useMemo(() => {
    if (!activePeer || !authUser?.username) return [];
    return messages[dmChatId(authUser.username, activePeer.username)] ?? [];
  }, [messages, activePeer, authUser?.username]);

  const existingUsernames = useMemo(
    () => new Set(Array.from(contacts.keys())),
    [contacts]
  );

  // ── Mark as read and fetch latest when opening a conversation ────────────
  // سینک کردن تیک دوم (خوانده شده) به صورت زنده
  // وقتی کاربر داخل چت است و پیام جدیدی روی صفحه ظاهر می‌شود
  useEffect(() => {
    if (!activePeer || !authUser) return;

    // آیا در این صفحه، پیامی از مخاطب داریم که وضعیتش read نباشد؟
    const hasUnread = activeMessages.some(
      (m) => m.senderUsername !== authUser.username && m.status !== "read"
    );

    if (hasUnread) {
      console.log(
        `[UI] 👀 User is viewing the chat. Marking new incoming messages as read...`
      );
      markAsRead(activePeer.username);
    }
  }, [activePeer, authUser, activeMessages, markAsRead]);
  // اضافه شدن activeMessages باعث می‌شود با هر پیام جدید، این هوک دوباره بررسی کند

  // ── Derive conversations ──────────────────────────────────────────────────
  const conversations = useMemo((): Conversation[] => {
    if (!authUser?.username) return [];

    const convMap = new Map<string, Conversation>();

    // ── Known contacts first (have nickname info) ─────────────────────────
    for (const [username, contact] of contacts.entries()) {
      const cid = dmChatId(authUser.username, username);
      const msgs = messages[cid] ?? [];
      const unread = msgs.filter(
        (m) => m.senderUsername !== authUser.username && m.status !== "read"
      ).length;

      convMap.set(username, {
        peerUsername: username,
        peerNickname: contact.nickname,
        lastMessage: msgs[msgs.length - 1] ?? null,
        unreadCount: unread,
        peerStatus: (peerStatuses[username] as UserStatus) ?? "offline",
        isTyping: typingPeers[username] ?? false,
      });
    }

    // ── Also surface conversations from pending/history that aren't in contacts ──
    // This handles the case where someone messages us before we've added them.
    for (const [cid, msgs] of Object.entries(messages)) {
      const parts = cid.split(":");
      const peerUsername = parts.find(
        (p) => p !== "dm" && p !== authUser.username.toLowerCase()
      );
      if (!peerUsername || convMap.has(peerUsername)) continue;

      const unread = msgs.filter(
        (m) => m.senderUsername !== authUser.username && m.status !== "read"
      ).length;

      convMap.set(peerUsername, {
        peerUsername,
        peerNickname: peerUsername, // no nickname available yet
        lastMessage: msgs[msgs.length - 1] ?? null,
        unreadCount: unread,
        peerStatus: (peerStatuses[peerUsername] as UserStatus) ?? "offline",
        isTyping: typingPeers[peerUsername] ?? false,
      });
    }

    return Array.from(convMap.values()).sort(
      (a, b) =>
        (b.lastMessage?.timestamp ?? 0) - (a.lastMessage?.timestamp ?? 0)
    );
  }, [messages, contacts, peerStatuses, typingPeers, authUser?.username]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleStartChat = useCallback((user: SearchedUser) => {
    const color = getAvatarColor(user.username);

    // Save to Dexie contacts
    upsertContact({
      username: user.username,
      nickname: user.nickname,
      avatarColor: color,
      addedAt: Date.now(),
    }).catch(console.error);

    // Update local state immediately (optimistic)
    setContacts((prev) =>
      new Map(prev).set(user.username, {
        username: user.username,
        nickname: user.nickname,
        avatarColor: color,
        addedAt: Date.now(),
      })
    );

    setActivePeer(user);
    setShowSearch(false);
    setIsMobileChatOpen(true);
  }, []);

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      const contact = contacts.get(conv.peerUsername);
      setActivePeer({
        username: conv.peerUsername,
        nickname: contact?.nickname ?? conv.peerNickname,
      });
      setIsMobileChatOpen(true);
    },
    [contacts]
  );

  // ─── Loading screen — wait for Dexie before rendering ────────────────────
  // This prevents a flash where the conversation list appears empty before
  // the IndexedDB data loads (usually < 50ms).
  if (!authUser) return null;

  const isLoading = !dbLoaded || !contactsLoaded;
  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <DatabaseIcon size={28} className="animate-pulse" />
          <p className="text-sm">Loading messages…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-slate-50 dark:bg-slate-900 overflow-hidden z-999">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside
        className={`flex flex-col w-full md:w-80 lg:w-96 flex-shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 ${
          isMobileChatOpen ? "hidden md:flex" : "flex"
        }`}
      >
        {/* Sidebar Header */}
        <header className="px-4 pt-5 pb-3 sticky top-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md z-10 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-2xl font-black tracking-tighter text-slate-900 dark:text-white leading-none">
                Whisp<span className="text-blue-500">.</span>
              </h1>
              <p className="text-[11px] text-slate-400 mt-0.5">
                @{authUser.username}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ConnectionBadge
                status={connectionStatus}
                onReconnect={reconnect}
              />
              <button
                onClick={() => setShowSearch((v) => !v)}
                className="p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 rounded-full hover:scale-110 transition-transform shadow-sm"
                aria-label="New conversation"
              >
                <Plus size={22} />
              </button>
            </div>
          </div>

          {showSearch && (
            <div className="mt-2">
              <UserSearch
                onStartChat={handleStartChat}
                existingUsernames={existingUsernames}
              />
            </div>
          )}

          {socketError && (
            <p className="mt-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">
              ⚠ {socketError}
            </p>
          )}
        </header>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8 py-16">
              <div className="text-4xl mb-4">💬</div>
              <p className="text-slate-500 dark:text-slate-400 text-sm">
                No conversations yet.
                <br />
                <button
                  onClick={() => setShowSearch(true)}
                  className="text-blue-500 hover:underline mt-1 font-medium"
                >
                  Find someone to whisper with
                </button>
              </p>
            </div>
          ) : (
            conversations.map((conv) => (
              <ConversationItem
                key={conv.peerUsername}
                conv={conv}
                isActive={activePeer?.username === conv.peerUsername}
                myUsername={authUser.username}
                onClick={() => handleSelectConversation(conv)}
              />
            ))
          )}
        </div>

        {/* Sidebar Footer */}
        <footer className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-3 z-999">
          <div
            className={`w-9 h-9 ${getAvatarColor(
              authUser.username
            )} rounded-xl flex items-center justify-center text-white font-bold text-sm`}
          >
            {(authUser.nickname || authUser.username)[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
              {authUser.nickname || authUser.username}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <FloatingTabBar />
          </div>
        </footer>
      </aside>

      {/* ── Chat Panel ──────────────────────────────────────────────────────── */}
      <main
        className={`flex-1 flex flex-col overflow-hidden ${
          isMobileChatOpen ? "flex" : "hidden md:flex"
        }`}
      >
        {activePeer ? (
          <ChatWindow
            messages={activeMessages}
            myUsername={authUser.username}
            peer={{
              username: activePeer.username,
              nickname: activePeer.nickname,
              avatarColor:
                contacts.get(activePeer.username)?.avatarColor ??
                getAvatarColor(activePeer.username),
            }}
            isPeerTyping={typingPeers[activePeer.username] ?? false}
            peerStatus={
              (peerStatuses[activePeer.username] as UserStatus) ?? "offline"
            }
            onSendMessage={(text) => sendMessage(activePeer.username, text)}
            onTypingStart={() => emitTypingStart(activePeer.username)}
            onTypingStop={() => emitTypingStop(activePeer.username)}
            onClearChat={() => clearChat(activePeer.username)}
            onBack={() => setIsMobileChatOpen(false)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-slate-900">
            <div className="text-center px-8">
              <div className="text-5xl mb-5">✨</div>
              <h2 className="text-xl font-black text-slate-800 dark:text-white tracking-tight mb-2">
                Select a conversation
              </h2>
              <p className="text-slate-400 text-sm">
                Choose from your list or start a new whisper
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
