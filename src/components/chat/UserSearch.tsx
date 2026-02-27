// src/components/chat/UserSearch.tsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Search, UserPlus, Loader2, X } from "lucide-react";
import type { SearchedUser, SearchResponse } from "../../types/chat";
import { useAuth } from "../../context/AuthContext";

const API_BASE =
  import.meta.env.VITE_API_URL ?? "https://whisp-project-server.onrender.com";
const DEBOUNCE_MS = 450;

interface UserSearchProps {
  /** Called when user selects someone to start a chat */
  onStartChat: (user: SearchedUser) => void;
  /** Already-friended usernames — excluded from results */
  existingUsernames?: Set<string>;
  className?: string;
}

export function UserSearch({
  onStartChat,
  existingUsernames = new Set(),
  className = "",
}: UserSearchProps) {
  const { authUser } = useAuth();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchedUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [sentInvites, setSentInvites] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const performSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setResults([]);
        return;
      }

      // Cancel any in-flight request
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setIsSearching(true);
      setSearchError(null);

      try {
        const res = await fetch(
          `${API_BASE}/api/v1/users/search?q=${encodeURIComponent(trimmed)}`,
          {
            signal: abortRef.current.signal,
            headers: authUser?.token
              ? { Authorization: `Bearer ${authUser.token}` }
              : {},
          }
        );

        if (!res.ok) throw new Error(`Search failed (${res.status})`);

        if (!res.ok) throw new Error(`Search failed (${res.status})`);

        const json: SearchResponse = await res.json();
        const users = json.data;

        const filtered = users.filter(
          (u) =>
            u.username !== authUser?.username &&
            !existingUsernames.has(u.username)
        );

        setResults(filtered);
      } catch (err) {
        if ((err as Error).name === "AbortError") return; // Ignore cancelled
        setSearchError("Search failed. Try again.");
      } finally {
        setIsSearching(false);
      }
    },
    [authUser, existingUsernames]
  );

  // Debounce the query → performSearch
  useEffect(() => {
    const timer = setTimeout(() => performSearch(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, performSearch]);

  function handleSelectUser(user: SearchedUser) {
    setSentInvites((prev) => new Set(prev).add(user.username));
    onStartChat(user);
    setQuery("");
    setResults([]);
  }

  function clearSearch() {
    setQuery("");
    setResults([]);
    setSearchError(null);
  }

  return (
    <div className={`relative ${className}`}>
      {/* Input */}
      <div className="relative group">
        <Search
          size={18}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors pointer-events-none"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search username to start chat…"
          className="w-full bg-slate-100 dark:bg-slate-800 dark:text-white rounded-2xl py-3 pl-11 pr-10 outline-none border-2 border-transparent focus:border-blue-500/40 transition-all text-sm"
        />
        {query && (
          <button
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
          >
            {isSearching ? (
              <Loader2 size={16} className="animate-spin text-blue-500" />
            ) : (
              <X size={16} />
            )}
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {(results.length > 0 || searchError) && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
          {searchError ? (
            <p className="p-4 text-sm text-red-500 text-center">
              {searchError}
            </p>
          ) : (
            <>
              <div className="px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-700">
                Users Found
              </div>
              {results.map((user) => {
                const alreadySent = sentInvites.has(user.username);
                return (
                  <button
                    key={user.username}
                    onClick={() => !alreadySent && handleSelectUser(user)}
                    disabled={alreadySent}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors disabled:opacity-60"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-linear-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                        {user.nickname?.[0]?.toUpperCase() ?? "?"}
                      </div>
                      <div className="text-left">
                        <p className="font-semibold text-sm text-slate-800 dark:text-slate-100">
                          {user.nickname}
                        </p>
                        <p className="text-xs text-slate-400">
                          @{user.username}
                        </p>
                      </div>
                    </div>
                    <div
                      className={`p-2 rounded-xl transition-colors ${
                        alreadySent
                          ? "bg-green-100 dark:bg-green-900/20 text-green-600"
                          : "bg-blue-50 dark:bg-blue-900/20 text-blue-600 hover:bg-blue-600 hover:text-white"
                      }`}
                    >
                      <UserPlus size={16} />
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* No results state */}
      {query.length >= 2 &&
        !isSearching &&
        results.length === 0 &&
        !searchError && (
          <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-700 p-4 text-center text-sm text-slate-400">
            No users found for &ldquo;{query}&rdquo;
          </div>
        )}
    </div>
  );
}
