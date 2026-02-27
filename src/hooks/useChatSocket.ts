// src/hooks/useChatSocket.ts
import { useEffect, useRef, useCallback, useReducer } from "react";
import { v4 as uuid } from "uuid";
import type {
  ChatMessage,
  ConnectionStatus,
  UserStatus,
  MessageStatus,
  UseChatSocketReturn,
} from "../types/chat";
import {
  upsertMessage,
  bulkUpsertMessages,
  markChatRead,
  type DbMessage,
  upsertContact,
  getRecentMessagesForHydration,
  getMessagesByChatId,
  db,
} from "../services/db";

const WS_URL = import.meta.env.DEV
  ? "ws://localhost:4000"
  : import.meta.env.VITE_WS_URL;

const MAX_RECONNECT_ATTEMPTS = 6;
const PING_INTERVAL_MS = 25_000;

export function dmChatId(a: string, b: string): string {
  return `dm:${[a.toLowerCase(), b.toLowerCase()].sort().join(":")}`;
}

// ─── State ────────────────────────────────────────────────────────────────────

interface SocketState {
  connectionStatus: ConnectionStatus;
  messages: Record<string, ChatMessage[]>;
  typingPeers: Record<string, boolean>;
  peerStatuses: Record<string, UserStatus>;
  dbLoaded: boolean;
  error: string | null;
}

type SocketAction =
  | { type: "DB_HYDRATED"; payload: ChatMessage[] }
  | { type: "CONNECTING" }
  | { type: "CONNECTED" }
  | { type: "RECONNECTING" }
  | { type: "DISCONNECTED" }
  | { type: "AUTH_FAILED"; payload: string }
  | { type: "ERROR"; payload: string }
  | { type: "MESSAGE_ADDED"; payload: ChatMessage }
  | {
      type: "MESSAGE_UPDATED";
      payload: { localId: string; message: ChatMessage };
    }
  | { type: "MESSAGES_BULK_ADD"; payload: ChatMessage[] }
  | {
      type: "MESSAGES_MARKED_READ";
      payload: { chatId: string; readerUsername: string };
    }
  // ← NEW: peer confirmed reading OUR messages → upgrade to 'read' (✓✓ blue)
  | {
      type: "MESSAGES_READ_BY_PEER";
      payload: { chatId: string; messageIds: string[] };
    }
  | {
      type: "TYPING_UPDATE";
      payload: { peerUsername: string; isTyping: boolean };
    }
  | { type: "PEER_STATUS"; payload: { username: string; status: UserStatus } }
  | { type: "CLEAR_CHAT"; payload: { chatId: string } }
  | {
      type: "MESSAGES_UPDATED_STATUS";
      payload: { chatId: string; messageIds: string[]; status: MessageStatus };
    };

function buildMap(msgs: ChatMessage[]): Record<string, ChatMessage[]> {
  const map: Record<string, ChatMessage[]> = {};
  for (const m of msgs) {
    if (!map[m.chatId]) map[m.chatId] = [];
    map[m.chatId].push(m);
  }
  for (const cid in map) map[cid].sort((a, b) => a.timestamp - b.timestamp);
  return map;
}

function reducer(state: SocketState, action: SocketAction): SocketState {
  switch (action.type) {
    case "DB_HYDRATED": {
      const nextMsgs = { ...state.messages };
      action.payload.forEach((msg) => {
        if (!nextMsgs[msg.chatId]) nextMsgs[msg.chatId] = [];
        if (!nextMsgs[msg.chatId].find((m) => m.localId === msg.localId)) {
          nextMsgs[msg.chatId].push(msg);
        }
      });
      for (const cid in nextMsgs)
        nextMsgs[cid] = [...nextMsgs[cid]].sort(
          (a, b) => a.timestamp - b.timestamp
        );
      return { ...state, messages: nextMsgs, dbLoaded: true };
    }

    case "CONNECTING":
      return { ...state, connectionStatus: "connecting", error: null };
    case "CONNECTED":
      return { ...state, connectionStatus: "connected", error: null };
    case "RECONNECTING":
      return { ...state, connectionStatus: "reconnecting" };
    case "DISCONNECTED":
      return { ...state, connectionStatus: "disconnected" };
    case "AUTH_FAILED":
      return {
        ...state,
        connectionStatus: "auth_failed",
        error: action.payload,
      };
    case "ERROR":
      return { ...state, error: action.payload };

    // Server ACKed our send → 'sending' → 'sent' (single ✓ gray)
    case "MESSAGE_UPDATED": {
      const { localId, message: serverMsg } = action.payload;
      const chatId = serverMsg.chatId;
      const nextMsgs = { ...state.messages };
      if (nextMsgs[chatId]) {
        nextMsgs[chatId] = nextMsgs[chatId].map((m) =>
          m.localId === localId
            ? {
                ...m,
                serverId: serverMsg.id,
                status: "sent" as MessageStatus,
                timestamp: serverMsg.timestamp,
              }
            : m
        );
      }
      return { ...state, messages: nextMsgs };
    }

    case "MESSAGE_ADDED": {
      const cid = action.payload.chatId;
      const existing = state.messages[cid] ?? [];
      if (existing.some((m) => m.localId === action.payload.localId))
        return state;
      return {
        ...state,
        messages: { ...state.messages, [cid]: [...existing, action.payload] },
      };
    }

    case "MESSAGES_BULK_ADD": {
      const next = { ...state.messages };
      for (const msg of action.payload) {
        const cid = msg.chatId;
        const existing = next[cid] ?? [];
        if (!existing.some((m) => m.localId === msg.localId))
          next[cid] = [...existing, msg];
      }
      for (const cid in next)
        next[cid] = [...next[cid]].sort((a, b) => a.timestamp - b.timestamp);
      return { ...state, messages: next };
    }

    // Local: WE read the peer's incoming messages → mark them as 'read'
    case "MESSAGES_MARKED_READ": {
      const { chatId, readerUsername } = action.payload;
      const nextMsgs = { ...state.messages };
      if (nextMsgs[chatId]) {
        nextMsgs[chatId] = nextMsgs[chatId].map((m) =>
          m.senderUsername !== readerUsername && m.status !== "read"
            ? { ...m, status: "read" }
            : m
        );
      }
      return { ...state, messages: nextMsgs };
    }

    // Remote: PEER read our outgoing messages → upgrade 'sent'/'delivered' → 'read' (✓✓ blue)
    case "MESSAGES_READ_BY_PEER": {
      const { chatId, messageIds } = action.payload;
      const nextMsgs = { ...state.messages };

      if (nextMsgs[chatId]) {
        nextMsgs[chatId] = nextMsgs[chatId].map((m) =>
          messageIds.includes(m.localId) ? { ...m, status: "read" } : m
        );
      }
      return { ...state, messages: nextMsgs };
    }

    case "MESSAGES_UPDATED_STATUS": {
      const { chatId, messageIds, status } = action.payload;
      const nextMsgs = { ...state.messages };
      if (nextMsgs[chatId]) {
        nextMsgs[chatId] = nextMsgs[chatId].map((m) =>
          (m.serverId && messageIds.includes(m.serverId)) || messageIds.includes(m.localId)
            ? { ...m, status }
            : m
        );
      }
      return { ...state, messages: nextMsgs };
    }

    case "TYPING_UPDATE":
      return {
        ...state,
        typingPeers: {
          ...state.typingPeers,
          [action.payload.peerUsername]: action.payload.isTyping,
        },
      };

    case "PEER_STATUS":
      return {
        ...state,
        peerStatuses: {
          ...state.peerStatuses,
          [action.payload.username]: action.payload.status,
        },
      };

    case "CLEAR_CHAT": {
      const next = { ...state.messages };
      delete next[action.payload.chatId];
      return { ...state, messages: next };
    }

    default:
      return state;
  }
}

const initialState: SocketState = {
  connectionStatus: "idle",
  messages: {},
  typingPeers: {},
  peerStatuses: {},
  dbLoaded: false,
  error: null,
};

// ─── Wire Types ───────────────────────────────────────────────────────────────

interface WireMessage {
  id: string;
  localId?: string;
  chatId: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
}

type ServerFrame =
  | { type: "message_sent"; localId?: string; message: WireMessage }
  | { type: "new_message"; message: WireMessage }
  | { type: "pending_messages"; messages: WireMessage[]; messageIds: string[] }
  | { type: "history"; chatId: string; with: string; messages: WireMessage[] }
  | { type: "typing_start"; from: string }
  | { type: "typing_stop"; from: string }
  | {
      type: "user_status_change";
      username: string;
      status: "online" | "offline";
    }
  // ← NEW: our outgoing messages were read by the peer
  | { type: "messages_read"; chatId: string; messageIds: string[]; by: string }
  | { type: "pong"; ts: number }
  | { type: "error"; message: string; code: number };

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useChatSocket({
  token,
  myUsername,
}: {
  token?: string | null;
  myUsername?: string | null;
}): UseChatSocketReturn {
  const [state, dispatch] = useReducer(reducer, initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const isMountedRef = useRef(true);
  const intentionalCloseRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {}
  );

  // ─── Dexie Hydration ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!myUsername) return;
    getRecentMessagesForHydration()
      .then((msgs: any) => {
        if (!isMountedRef.current) return;
        dispatch({ type: "DB_HYDRATED", payload: msgs });
        console.info(`[WS] Dexie hydrated: ${msgs.length} messages`);
      })
      .catch((err: any) => {
        console.error("[WS] Dexie hydration error:", err);
        dispatch({ type: "DB_HYDRATED", payload: [] });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUsername]);

  // ─── Connect ─────────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (!token || !myUsername || !isMountedRef.current) return;

    if (wsRef.current) {
      intentionalCloseRef.current = true;
      wsRef.current.close(1000, "Reconnecting");
      wsRef.current = null;
    }

    dispatch({ type: "CONNECTING" });

    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    intentionalCloseRef.current = false;

    ws.onopen = () => {
      if (!isMountedRef.current) return;
      reconnectAttemptsRef.current = 0;
      dispatch({ type: "CONNECTED" });
      console.info(`[WS] Connected as "${myUsername}"`);
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "ping" }));
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = async (event) => {
      if (!isMountedRef.current) return;

      let data: ServerFrame;
      try {
        data = JSON.parse(event.data) as ServerFrame;
      } catch {
        console.error("[WS] Bad JSON frame");
        return;
      }

      if (data.type !== "pong") console.debug(`[WS] ← ${data.type}`);

      switch (data.type) {
        // ── Server ACKed our send → 'sending' → 'sent' (✓ gray) ────────────
        case "message_sent": {
          const serverMsg = data.message;
          dispatch({
            type: "MESSAGE_UPDATED",
            payload: {
              localId: data.localId ?? "",
              message: serverMsg as unknown as ChatMessage,
            },
          });
          import("../services/db").then(({ upsertMessage }) => {
            upsertMessage({
              localId: data.localId ?? "",
              chatId: serverMsg.chatId,
              senderUsername: serverMsg.from,
              receiverUsername: serverMsg.to,
              text: serverMsg.text,
              timestamp: serverMsg.timestamp,
              status: "sent",
            } as any).catch(console.error);
          });
          break;
        }

        // ── Incoming from peer → 'delivered' (✓✓ gray) ──────────────────────
        case "new_message": {
          const msg = data.message;
          const incomingMsg: ChatMessage = {
            localId: msg.id,
            chatId: msg.chatId,
            senderUsername: msg.from,
            receiverUsername: myUsername!,
            text: msg.text,
            timestamp: msg.timestamp,
            status: "delivered",
          };
          dispatch({ type: "MESSAGE_ADDED", payload: incomingMsg });
          upsertMessage(incomingMsg as any).catch(console.error);
          upsertContact({
            username: msg.from,
            nickname: msg.from,
            addedAt: Date.now(),
          }).catch(console.error);
          break;
        }

        // ── Offline messages flushed on reconnect ───────────────────────────
        case "pending_messages": {
          const msgs: ChatMessage[] = data.messages.map((msg: any) => ({
            localId: msg.id,
            chatId: msg.chatId,
            senderUsername: msg.from,
            receiverUsername: myUsername!,
            text: msg.text,
            timestamp: msg.timestamp,
            status: "delivered",
          }));
          msgs.forEach((m) => dispatch({ type: "MESSAGE_ADDED", payload: m }));
          bulkUpsertMessages(msgs as any[]).catch(console.error);
          ws.send(
            JSON.stringify({ type: "ack_pending", ids: data.messageIds })
          );
          break;
        }

        // ── History from server ─────────────────────────────────────────────
        case "history": {
          const { chatId, with: peer, messages: hist } = data;
          const chatMsgs: ChatMessage[] = hist.map((m: any) => ({
            localId: m.id,
            chatId,
            senderUsername: m.from,
            receiverUsername: m.from === myUsername ? peer : myUsername,
            text: m.text,
            timestamp: m.timestamp,
            status: (m.from === myUsername
              ? "sent"
              : "delivered") as MessageStatus,
          }));
          dispatch({ type: "MESSAGES_BULK_ADD", payload: chatMsgs });
          bulkUpsertMessages(chatMsgs as DbMessage[]).catch(console.error);
          break;
        }

        // ── ✓✓ BLUE — Peer read our messages ─────────────────────────────────
        // Server sends this when recipient calls mark_read for our chat
        case "messages_read": {
          console.debug(
            `[WS] ← messages_read chatId:${data.chatId} count:${data.messageIds?.length}`
          );
          dispatch({
            type: "MESSAGES_UPDATED_STATUS",
            payload: {
              chatId: data.chatId,
              messageIds: data.messageIds,
              status: "read",
            },
          });

          import("../services/db").then(({ db }) => {
            db.transaction("rw", db.messages, async () => {
              // رفع باگ دیتابیس: پیام‌های این چت را می‌گیریم و با serverId مقایسه می‌کنیم
              await db.messages
                .where("chatId")
                .equals(data.chatId)
                .filter(m => 
                  (m.serverId && data.messageIds.includes(m.serverId)) || 
                  data.messageIds.includes(m.localId)
                )
                .modify({ status: "read" });
            }).catch(console.error);
          });
          break;
        }

        case "typing_start": {
          dispatch({
            type: "TYPING_UPDATE",
            payload: { peerUsername: data.from, isTyping: true },
          });
          clearTimeout(typingTimerRef.current[data.from]);
          typingTimerRef.current[data.from] = setTimeout(() => {
            if (isMountedRef.current)
              dispatch({
                type: "TYPING_UPDATE",
                payload: { peerUsername: data.from, isTyping: false },
              });
          }, 3_000);
          break;
        }

        case "typing_stop":
          clearTimeout(typingTimerRef.current[data.from]);
          dispatch({
            type: "TYPING_UPDATE",
            payload: { peerUsername: data.from, isTyping: false },
          });
          break;

        case "user_status_change":
          dispatch({
            type: "PEER_STATUS",
            payload: { username: data.username, status: data.status },
          });
          break;

        case "pong":
          break;

        case "error":
          console.error(`[WS] Server error (${data.code}): ${data.message}`);
          dispatch({
            type: "ERROR",
            payload: `[${data.code}] ${data.message}`,
          });
          break;
      }
    };

    ws.onerror = () => console.error("[WS] Socket error");

    ws.onclose = (event: CloseEvent) => {
      if (!isMountedRef.current) return;
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      console.info(`[WS] Closed code:${event.code} "${event.reason}"`);
      if (event.code === 4001 || event.code === 1006) {
        dispatch({
          type: "AUTH_FAILED",
          payload: "Auth failed. Please sign in again.",
        });
        return;
      }
      dispatch({ type: "DISCONNECTED" });
      if (
        event.code !== 1000 &&
        event.code !== 1001 &&
        !intentionalCloseRef.current
      ) {
        scheduleReconnect();
      }
    };
  }, [token, myUsername]);

  const scheduleReconnect = useCallback(() => {
    if (!isMountedRef.current) return;
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      dispatch({
        type: "ERROR",
        payload: "Could not reconnect after multiple attempts.",
      });
      return;
    }
    const delay = Math.min(
      1_000 * Math.pow(2, reconnectAttemptsRef.current),
      30_000
    );
    reconnectAttemptsRef.current++;
    dispatch({ type: "RECONNECTING" });
    console.warn(
      `[WS] Reconnect in ${delay}ms (${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`
    );
    reconnectTimerRef.current = setTimeout(connect, delay);
  }, [connect]);

  useEffect(() => {
    isMountedRef.current = true;
    if (!token || !myUsername) return;
    connect();
    return () => {
      isMountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
      Object.values(typingTimerRef.current).forEach(clearTimeout);
      typingTimerRef.current = {};
      intentionalCloseRef.current = true;
      wsRef.current?.close(1000, "Unmounted");
      wsRef.current = null;
    };
  }, [connect, token, myUsername]);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    (receiverUsername: string, text: string) => {
      if (!myUsername) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      const localId = uuid();
      const chatId = dmChatId(myUsername, receiverUsername);
      const optimisticMsg: ChatMessage = {
        localId,
        chatId,
        senderUsername: myUsername,
        receiverUsername,
        text: trimmed,
        timestamp: Date.now(),
        status: "sending",
      };
      dispatch({ type: "MESSAGE_ADDED", payload: optimisticMsg });
      import("../services/db").then(({ upsertMessage }) => {
        upsertMessage(optimisticMsg as any).catch(console.error);
      });
      ws.send(
        JSON.stringify({
          type: "send_message",
          to: receiverUsername,
          content: trimmed,
          localId,
        })
      );
    },
    [myUsername]
  );

  const emitTypingStart = useCallback((to: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: "typing_start", to }));
  }, []);

  const emitTypingStop = useCallback((to: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: "typing_stop", to }));
  }, []);

  /**
   * markAsRead
   * ──────────────────────────────────────────────────────────────────────────
   * Called when the user opens a chat window.
   * Two simultaneous effects:
   *
   * 1. LOCAL  — mark peer's incoming messages as 'read' in our own state/Dexie
   *             so unread badges disappear.
   *
   * 2. REMOTE — send `mark_read` to server with the IDs of messages we just saw.
   *             Server forwards `messages_read` to the peer.
   *             Peer's ✓✓ gray → ✓✓ blue.
   */
  const markAsRead = useCallback(
    (peerUsername: string) => {
      if (!myUsername) return;
      const chatId = dmChatId(myUsername, peerUsername);

      import("../services/db").then(({ db, markChatRead }) => {
        db.messages
          .where("chatId")
          .equals(chatId)
          .toArray()
          .then((dbMsgs) => {
            const unreadFromPeer = dbMsgs
              .filter(
                (m: any) =>
                  m.senderUsername !== myUsername &&
                  m.status !== "read" &&
                  (m.serverId || m.localId) 
              )
              // استخراج دقیق آیدی سرور برای ارسال به مخاطب
              .map((m: any) => m.serverId || m.localId);

            if (unreadFromPeer.length === 0) return;
            if (wsRef.current?.readyState !== WebSocket.OPEN) return;

            console.log(`[WS] 📤 Sending mark_read to server for ${unreadFromPeer.length} messages...`);
            wsRef.current.send(
              JSON.stringify({
                type: "mark_read",
                to: peerUsername,
                messageIds: unreadFromPeer,
              })
            );

            dispatch({
              type: "MESSAGES_MARKED_READ",
              payload: { chatId, readerUsername: myUsername },
            });
            markChatRead(chatId, myUsername).catch(console.error);
          })
          .catch(console.error);
      });
    },
    [myUsername]
  );

  const clearChat = useCallback((chatId: string) => {
    dispatch({ type: "CLEAR_CHAT", payload: { chatId } });
    import("../services/db").then(({ db }) => {
      db.messages.where("chatId").equals(chatId).delete().catch(console.error);
    });
  }, []);

  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  return {
    connectionStatus: state.connectionStatus,
    messages: state.messages,
    typingPeers: state.typingPeers,
    peerStatuses: state.peerStatuses,
    dbLoaded: state.dbLoaded,
    error: state.error,
    clearChat,
    sendMessage,
    emitTypingStart,
    emitTypingStop,
    markAsRead,
    reconnect,
  };
}
