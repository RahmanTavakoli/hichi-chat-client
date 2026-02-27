import{
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
  useEffect,
} from "react";
import type {
  AuthUser,
  AuthContextValue,
  LoginApiResponse,
} from "../types/chat";

const API_BASE = import.meta.env.DEV ? "" : import.meta.env.VITE_API_URL;

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // ── Token lives here in RAM only — never touches localStorage/sessionStorage ──
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref so socket hook can always read the freshest token without re-subscribing
  const authUserRef = useRef<AuthUser | null>(null);
  authUserRef.current = authUser;

  // ─── Login ──────────────────────────────────────────────────────────────────
  const login = useCallback(
    async (username: string, password: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Include credentials so the server can also set HttpOnly cookies if configured
          credentials: "include",
          body: JSON.stringify({ username, password }),
        });

        const data: LoginApiResponse = await res.json();

        if (!res.ok) {
          throw new Error(
            data.message ?? `Login failed (${res.status})`
          );
        }

        // Validate server returned a token
        if (!data.token) {
          throw new Error("Server did not return an authentication token.");
        }

        setAuthUser({
          username: data.username,
          nickname: data.nickname,
          avatar_url: data.avatar_url,
          token: data.token,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown login error";
        setError(message);
        throw err; // Re-throw so the Login component can react
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // ─── Register ────────────────────────────────────────────────────────────────
  const register = useCallback(
    async (
      username: string,
      nickname: string,
      password: string
    ): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(`${API_BASE}/api/v1/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ username, nickname, password }),
        });

        const data: LoginApiResponse = await res.json();

        if (!res.ok) {
          throw new Error(
            data.message ?? `Registration failed (${res.status})`
          );
        }

        setAuthUser({
          username: data.username,
          nickname: data.nickname,
          avatar_url: data.avatar_url,
          token: '',
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown registration error";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // ─── Auto-Login on Mount (Refresh Flow) ────────────────────────────────────
  useEffect(() => {
    const initAuth = async () => {
      try {
        setIsLoading(true);
        // ارسال درخواست به روت رفرش توکن در بک‌اند
        // چون credentials: 'include' است، مرورگر کوکی refreshToken را خودکار می‌فرستد
        const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
          method: "POST", // یا GET، بستگی به متد تعریف شده در بک‌اند دارد
          credentials: "include",
        });

        if (res.ok) {
          const data = await res.json();
          // بازگردانی کاربر به استیت برنامه بدون نیاز به لاگین مجدد
          setAuthUser({
            username: data.username,
            nickname: data.nickname || data.username,
            avatar_url: data.avatar_url,
            token: data.token, // توکن اکسس جدید دریافتی
          });
        }
      } catch (err) {
        // اگر رفرش توکن منقضی شده بود، بیخیال می‌شویم تا کاربر خودش لاگین کند
        console.warn("Auto-login failed, user needs to sign in manually.");
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  // ─── Logout ───────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      setIsLoading(true);
      // ۱. ارسال درخواست به بک‌اند برای پاک کردن HttpOnly Cookies و refreshTokenHash
      await fetch(`${API_BASE}/api/v1/auth/logout`, {
        method: "POST",
        credentials: "include", // برای ارسال کوکی‌ها در درخواست
      });
    } catch (err) {
      console.error("Logout API failed:", err);
    } finally {
      // ۲. پاک کردن اطلاعات از RAM (State ری‌اکت)
      setAuthUser(null);
      authUserRef.current = null;
      setError(null);
      setIsLoading(false);

      // ۳. پاک کردن فیزیکی اطلاعات از هارد سیستم (Dexie)
      // این کار ضروری است تا اگر شخص دیگری با همین سیستم لاگین کرد، چت‌های کاربر قبلی را نبیند
      import("../services/db").then(({ clearAllDatabase }) => {
        clearAllDatabase()
          .then(() => console.info("[Auth] Local database wiped on logout."))
          .catch(console.error);
      });
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider
      value={{
        authUser,
        isLoading,
        error,
        login,
        register,
        logout,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────────
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
