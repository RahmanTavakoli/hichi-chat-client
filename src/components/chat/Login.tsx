// src/components/chat/Login.tsx
import React, { useState, useCallback, type FormEvent } from 'react';
import {
  Sparkles, AtSign, Lock, User,
  ArrowRight, Loader2, AlertCircle, Eye, EyeOff,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  loginSchema,
  registerSchema,
  validateSchema,
  type AuthFields,
} from '../../schema/auth.schema';

// ─── Types ──────────────────────────────────────────────────────────────────

type Mode = 'login' | 'register';

// Field-level error map — only the keys that exist in AuthFields
type FieldErrors = Partial<Record<keyof AuthFields | 'confirmPassword', string>>;

// ─── Initial state ───────────────────────────────────────────────────────────

const EMPTY_FIELDS: AuthFields & { confirmPassword: string } = {
  username: '',
  nickname: '',
  password: '',
  confirmPassword: '',
};

// ─── Shared Tailwind classes ─────────────────────────────────────────────────

const inputBase =
  'w-full bg-slate-100 dark:bg-slate-800 dark:text-white rounded-2xl py-4 pl-12 pr-4 outline-none border-2 transition-all shadow-sm placeholder:text-slate-400';

function inputClass(error?: string) {
  return `${inputBase} ${
    error
      ? 'border-red-400 dark:border-red-500 focus:border-red-400'
      : 'border-transparent focus:border-blue-500/50'
  }`;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface FieldWrapperProps {
  error?: string;
  children: React.ReactNode;
}

function FieldWrapper({ error, children }: FieldWrapperProps) {
  return (
    <div className="space-y-1">
      <div className="relative group">{children}</div>
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400 flex items-center gap-1 pl-1">
          <AlertCircle size={11} className="flex-shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

interface IconProps {
  component: React.ElementType;
  hasError?: boolean;
}

function InputIcon({ component: Icon, hasError }: IconProps) {
  return (
    <Icon
      className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${
        hasError
          ? 'text-red-400'
          : 'text-slate-400 group-focus-within:text-blue-500'
      }`}
      size={18}
    />
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function Login() {
  const { login, register, isLoading, error: apiError, clearError } = useAuth();

  const [mode, setMode] = useState<Mode>('login');
  const [showPassword, setShowPassword] = useState(false);
  const [fields, setFields] = useState({ ...EMPTY_FIELDS });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const { name, value } = e.target;
      setFields((prev) => ({ ...prev, [name]: value }));

      // Clear that field's error as user types (eager feedback)
      setFieldErrors((prev) => {
        if (!prev[name as keyof FieldErrors]) return prev;
        const next = { ...prev };
        delete next[name as keyof FieldErrors];
        return next;
      });

      if (apiError) clearError();
    },
    [apiError, clearError],
  );

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      // ── Validate ─────────────────────────────────────────────────────────
      const schema = mode === 'login' ? loginSchema : registerSchema;
      const errors = await validateSchema(schema as Parameters<typeof validateSchema>[0], fields);

      if (errors) {
        setFieldErrors(errors as FieldErrors);
        return;
      }

      setFieldErrors({});

      // ── Submit ───────────────────────────────────────────────────────────
      try {
        if (mode === 'login') {
          await login(fields.username.trim().toLowerCase(), fields.password);
        } else {
          await register(
            fields.username.trim().toLowerCase(),
            fields.nickname.trim(),
            fields.password,
          );
        }
      } catch {
        // Error already surfaced via context → rendered as apiError
      }
    },
    [mode, fields, login, register],
  );

  /**
   * Toggle between login ↔ register.
   * 
   * Preservation strategy:
   *  - username  → always kept (shared field)
   *  - password  → kept when going login→register (less friction)
   *              → cleared when going register→login (security UX)
   *  - nickname, confirmPassword → register-only, cleared on switch
   */
  const toggleMode = useCallback(() => {
    setMode((current) => {
      const next: Mode = current === 'login' ? 'register' : 'login';

      setFields((prev) => ({
        username: prev.username,           // always preserve
        password: next === 'register' ? prev.password : '', // keep on ↑, clear on ↓
        nickname: '',
        confirmPassword: '',
      }));

      setFieldErrors({});
      clearError();
      return next;
    });
  }, [clearError]);

  // ─── Render ───────────────────────────────────────────────────────────────

  const isRegister = mode === 'register';

  return (
    <div className="flex flex-col min-h-screen bg-white dark:bg-slate-900 px-8 py-12 justify-center transition-colors duration-300">

      {/* ── Brand ── */}
      <div className="mb-10 text-center">
        <div className="inline-flex p-4 bg-blue-50 dark:bg-blue-900/30 rounded-3xl text-blue-600 mb-4 shadow-inner">
          <Sparkles size={40} />
        </div>
        <h1 className="text-4xl font-black tracking-tighter text-slate-900 dark:text-white">
          Whisp<span className="text-blue-500">.</span>
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm italic">
          {isRegister ? 'Join the secret circle.' : 'Welcome back, Whisperer.'}
        </p>
      </div>

      {/* ── API / Global Error Banner ── */}
      {apiError && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/30 rounded-2xl flex items-center gap-3 text-red-600 dark:text-red-400 text-sm">
          <AlertCircle size={18} className="flex-shrink-0" />
          <span>{apiError}</span>
        </div>
      )}

      {/* ── Form ── */}
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>

        {/* Display Name — register only */}
        {isRegister && (
          <FieldWrapper error={fieldErrors.nickname}>
            <InputIcon component={User} hasError={!!fieldErrors.nickname} />
            <input
              name="nickname"
              type="text"
              placeholder="Display Name"
              autoComplete="name"
              value={fields.nickname}
              onChange={handleChange}
              className={inputClass(fieldErrors.nickname)}
            />
          </FieldWrapper>
        )}

        {/* Username */}
        <FieldWrapper error={fieldErrors.username}>
          <InputIcon component={AtSign} hasError={!!fieldErrors.username} />
          <input
            name="username"
            type="text"
            placeholder="Username"
            autoComplete="username"
            value={fields.username}
            onChange={handleChange}
            className={inputClass(fieldErrors.username)}
          />
        </FieldWrapper>

        {/* Password */}
        <FieldWrapper error={fieldErrors.password}>
          <InputIcon component={Lock} hasError={!!fieldErrors.password} />
          <input
            name="password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            value={fields.password}
            onChange={handleChange}
            className={`${inputClass(fieldErrors.password)} pr-12`}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </FieldWrapper>

        {/* Confirm Password — register only */}
        {isRegister && (
          <FieldWrapper error={fieldErrors.confirmPassword}>
            <InputIcon component={Lock} hasError={!!fieldErrors.confirmPassword} />
            <input
              name="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              placeholder="Confirm Password"
              autoComplete="new-password"
              value={fields.confirmPassword}
              onChange={handleChange}
              className={inputClass(fieldErrors.confirmPassword)}
            />
          </FieldWrapper>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-60 group mt-2"
        >
          {isLoading ? (
            <Loader2 className="animate-spin" size={20} />
          ) : (
            <>
              {isRegister ? 'Create Account' : 'Sign In'}
              <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </>
          )}
        </button>
      </form>

      {/* ── Toggle Mode ── */}
      <div className="mt-8 text-center">
        <button
          onClick={toggleMode}
          className="text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
        >
          {isRegister
            ? 'Already have an account? Sign In'
            : 'New here? Create an account'}
        </button>
      </div>
    </div>
  );
}