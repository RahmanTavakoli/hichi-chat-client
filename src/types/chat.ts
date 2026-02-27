// ─── Core Domain Types ────────────────────────────────────────────────────────

export type MessageStatus =
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";
export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "auth_failed";
export type UserStatus = "online" | "offline" | "away";

export interface User {
  id?: string;
  username: string;
  nickname: string;
  avatar_url?: string;
  bio?: string;
}

export interface AuthUser extends User {
  token: string; // JWT — held in memory only, never persisted to localStorage
}

export interface SearchedUser {
  username: string;
  nickname: string;
  avatar_url?: string;
}

export interface SearchResponse {
  status: string;
  count: number;
  data: SearchedUser[];
}

export interface ChatMessage {
  /** Client-generated optimistic ID before server ACK */
  id?:string;
  localId: string;
  serverId?: string;
  chatId: string; // conversationKey: `${myUsername}:${peerUsername}` (sorted)
  senderUsername: string;
  receiverUsername: string;
  text: string;
  timestamp: number;
  status: MessageStatus;
}

export interface Conversation {
  peerUsername: string;
  peerNickname: string;
  lastMessage: ChatMessage | null;
  unreadCount: number;
  peerStatus: UserStatus;
  isTyping: boolean;
}

// ─── Socket Payload Types ──────────────────────────────────────────────────────

/** Emitted by client when sending a message */
export interface SendMessagePayload {
  sender: string;
  receiver: string;
  content: string;
}

/** Received from server for an incoming message */
export interface IncomingMessagePayload {
  sender: string;
  receiver: string;
  content: string;
  timestamp: number;
  messageId?: string;
}

/** Emitted when all messages in a chat are read */
export interface MessageReadSyncPayload {
  sender: string; // the peer whose messages we just read
  receiver: string; // us
}

/** Received when the peer has read our messages */
export interface MessageSeenPayload {
  by: string; // peer username
}

export interface TypingPayload {
  to: string;
  from: string;
}

export interface UserStatusPayload {
  username: string;
  status: UserStatus;
}

export interface OfflineMessage {
  sender_username: string;
  receiver_username: string;
  content: string;
  timestamp: number;
}

// ─── Hook Return Types ─────────────────────────────────────────────────────────

export interface UseChatSocketReturn {
  /** Current WebSocket connection state */
  connectionStatus: ConnectionStatus;
  /** All in-memory messages, keyed by conversationId */
  messages: Record<string, ChatMessage[]>;
  /** Usernames currently typing to us, keyed by their username */
  typingPeers: Record<string, boolean>;
  /** Online status of peers, keyed by username */
  peerStatuses: Record<string, UserStatus>;
  /** Send a message to a specific receiver */
  sendMessage: (receiverUsername: string, text: string) => void;
  /** Notify server we are typing */
  emitTypingStart: (receiverUsername: string) => void;
  /** Notify server we stopped typing */
  emitTypingStop: (receiverUsername: string) => void;
  /** Mark all messages from a peer as read */
  markAsRead: (peerUsername: string) => void;
  /** Manually trigger remove chat */
  clearChat: (peerUsername: string) => void;
  /** Manually trigger a reconnect */
  reconnect: () => void;
  dbLoaded: any
  /** Last error, if any */
  error: string | null;
}

// ─── Auth Context Types ────────────────────────────────────────────────────────

export interface AuthContextValue {
  authUser: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (
    username: string,
    nickname: string,
    password: string
  ) => Promise<void>;
  logout: () => void;
  clearError: () => void;
}

// ─── REST API Response Types ───────────────────────────────────────────────────

export interface LoginApiResponse {
  token: string;
  username: string;
  nickname: string;
  avatar_url?: string;
  error?: string;
  message?: string;
}

export interface SearchApiResponse {
  username: string;
  nickname: string;
  avatar_url?: string;
  message?: string;
}

export interface ApiErrorResponse {
  error: string;
  message?: string;
}
