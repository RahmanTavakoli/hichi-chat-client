import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
} from 'react';
import {
  Send, Paperclip, ArrowLeft, MoreVertical,
  CheckCheck, Check, Clock,
} from 'lucide-react';
import type { ChatMessage, UserStatus } from '../../types/chat';

interface ChatWindowProps {
  messages: ChatMessage[];
  myUsername: string;
  peer: { username: string; nickname: string; avatarColor?: string };
  isPeerTyping: boolean;
  peerStatus: UserStatus;
  onSendMessage: (text: string) => void;
  onTypingStart: () => void;
  onTypingStop: () => void;
  onBack?: () => void;
  onClearChat: () => void;
}

const TYPING_STOP_DELAY = 2_000;

// ─── Status Icon ──────────────────────────────────────────────────────────────
//
//  sending   → ⏱  clock (gray, pulsing) — in transit to server
//  sent      → ✓   single check (gray)  — server received
//  delivered → ✓✓  double check (gray)  — peer device received
//  read      → ✓✓  double check (blue)  — peer opened and saw it
//  failed    → !   red exclamation
//
function StatusIcon({ status }: { status: ChatMessage['status'] }) {
  switch (status) {
    case 'sending':
      return (
        <Clock
          size={15}
          className="text-blue-200/60 animate-pulse"
          aria-label="Sending"
        />
      );
    case 'failed':
      return (
        <span
          className="text-[11px] font-bold text-red-400 leading-none"
          aria-label="Failed"
        >
          !
        </span>
      );
    case 'sent':
      return (
        <Check
          size={15}
          className="text-blue-200/60"
          aria-label="Sent"
          strokeWidth={2.5}
        />
      );
    case 'delivered':
      return (
        <CheckCheck
          size={15}
          className="text-blue-200/60"
          aria-label="Delivered"
          strokeWidth={2.5}
        />
      );
    case 'read':
      return (
        <CheckCheck
          size={15}
          className="text-sky-950"
          aria-label="Read"
          strokeWidth={2.5}
        />
      );
    default:
      return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ChatWindow({
  messages,
  myUsername,
  peer,
  isPeerTyping,
  peerStatus,
  onSendMessage,
  onTypingStart,
  onTypingStop,
  onBack,
  onClearChat,
}: ChatWindowProps) {
  const [draft, setDraft] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isTypingEmitRef = useRef(false);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isPeerTyping]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setDraft(e.target.value);

      // Auto-resize textarea
      const ta = textareaRef.current;
      if (ta) {
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 128)}px`;
      }

      if (!isTypingEmitRef.current) {
        onTypingStart();
        isTypingEmitRef.current = true;
      }

      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        onTypingStop();
        isTypingEmitRef.current = false;
      }, TYPING_STOP_DELAY);
    },
    [onTypingStart, onTypingStop],
  );

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    onSendMessage(text);
    setDraft('');
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    onTypingStop();
    isTypingEmitRef.current = false;
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [draft, onSendMessage, onTypingStop]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="flex flex-col h-full bg-[#f0f2f5] dark:bg-[#0b141a]">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="px-4 py-3 flex items-center gap-3 bg-white/90 dark:bg-[#202c33]/95 backdrop-blur-md sticky top-0 z-30 shadow-sm border-b border-slate-100 dark:border-slate-800/50">
        {onBack && (
          <button
            onClick={onBack}
            className="p-1.5 -ml-1 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Go back"
          >
            <ArrowLeft size={22} />
          </button>
        )}

        <div className="relative">
          <div
            className={`w-10 h-10 ${peer.avatarColor ?? 'bg-blue-600'} rounded-2xl flex items-center justify-center text-white font-bold text-base shadow`}
          >
            {peer.nickname[0].toUpperCase()}
          </div>
          <div
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-[#202c33] transition-colors ${
              peerStatus === 'online' ? 'bg-green-500' : 'bg-slate-400'
            }`}
          />
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-[15px] text-slate-800 dark:text-slate-100 truncate leading-tight">
            {peer.nickname}
          </h2>
          <p
            className={`text-[11px] font-medium leading-tight transition-colors ${
              isPeerTyping
                ? 'text-blue-500 animate-pulse'
                : peerStatus === 'online'
                  ? 'text-green-500'
                  : 'text-slate-400'
            }`}
          >
            {isPeerTyping
              ? 'is whisping…'
              : peerStatus === 'online'
                ? 'online'
                : 'offline'}
          </p>
        </div>

        {/* ── 3-dot menu ──────────────────────────────────────────────────── */}
        <div className="relative">
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="p-2 text-slate-400 hover:text-slate-600 transition-colors rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="More options"
          >
            <MoreVertical size={20} />
          </button>

          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700 py-2 z-50 overflow-hidden">
                <button
                  onClick={() => {
                    onClearChat();
                    setShowMenu(false);
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium transition-colors"
                >
                  Clear Chat History
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* ── Messages ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-5 flex flex-col gap-0.5">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-slate-400 text-sm italic text-center px-8">
              Say hello to {peer.nickname} 👋
            </p>
          </div>
        )}

        {messages.map((msg, index, arr) => {
          const isMe = msg.senderUsername === myUsername;
          const prevMsg = arr[index - 1];
          const nextMsg = arr[index + 1];
          const isContinuation = prevMsg?.senderUsername === msg.senderUsername;
          const isLastInGroup = nextMsg?.senderUsername !== msg.senderUsername;

          return (
            <div
              key={msg.localId}
              className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'} ${
                isContinuation ? 'mt-0.5' : 'mt-3'
              } ${isLastInGroup ? 'mb-1' : ''}`}
            >
              <div
                className={`
                  max-w-[78%] px-4 py-2.5 shadow-sm
                  ${isMe
                    ? `bg-blue-600 text-white ${
                        isContinuation
                          ? 'rounded-2xl rounded-tr-md'
                          : 'rounded-2xl rounded-tr-none'
                      }`
                    : `bg-white dark:bg-[#202c33] text-slate-800 dark:text-slate-100 ${
                        isContinuation
                          ? 'rounded-2xl rounded-tl-md'
                          : 'rounded-2xl rounded-tl-none'
                      }`
                  }
                  ${msg.status === 'failed' ? 'opacity-70 ring-1 ring-red-400' : ''}
                `}
              >
                <p className="text-[15px] leading-[1.45] whitespace-pre-wrap break-words">
                  {msg.text}
                </p>

                {/* ── Timestamp + Status ─────────────────────────────────── */}
                <div
                  className={`flex items-center justify-end gap-1 mt-0.5 ${
                    isMe ? 'text-blue-100/70' : 'text-slate-400'
                  }`}
                >
                  <span className="text-[9px] leading-none">
                    {formatTime(msg.timestamp)}
                  </span>
                  {isMe && <StatusIcon status={msg.status} />}
                </div>
              </div>
            </div>
          );
        })}

        {/* Typing Bubble */}
        {isPeerTyping && (
          <div className="flex justify-start mt-3">
            <div className="bg-white dark:bg-[#202c33] px-4 py-3 rounded-2xl rounded-tl-none shadow-sm">
              <div className="flex items-center gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input Bar ───────────────────────────────────────────────────────── */}
      <footer className="px-3 py-3 bg-[#f0f2f5] dark:bg-[#0b141a]">
        <div className="flex items-end gap-2">
          <button
            className="p-2.5 mb-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 flex-shrink-0"
            aria-label="Attach file"
          >
            <Paperclip size={20} />
          </button>

          <div className="flex-1 bg-white dark:bg-[#2a3942] rounded-[1.5rem] flex items-end px-4 py-1.5 shadow-sm">
            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Type a whisper…"
              className="flex-1 bg-transparent border-none outline-none py-2 text-[15px] dark:text-slate-100 placeholder:text-slate-400 resize-none max-h-32 leading-[1.4]"
              aria-label="Message input"
            />
          </div>

          <button
            onClick={handleSend}
            disabled={!draft.trim()}
            className="w-11 h-11 mb-0.5 flex-shrink-0 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shadow-lg shadow-blue-500/30 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            aria-label="Send message"
          >
            <Send size={19} className="translate-x-px" />
          </button>
        </div>
      </footer>
    </div>
  );
}