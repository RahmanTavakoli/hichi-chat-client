// ─── Single source of truth for all auth validation rules ──────────────────
// Rules intentionally mirror the backend (auth.schema.ts) — keep in sync.

import * as yup from 'yup';

// ─── Shared atomic validators ───────────────────────────────────────────────

const usernameValidator = yup
  .string()
  .required('Username is required.')
  .min(3, 'Username must be at least 3 characters.')
  .max(30, 'Username must be under 30 characters.')
  .matches(
    /^[a-zA-Z0-9_]+$/,
    'Username may only contain letters, numbers, and underscores.',
  )
  .lowercase();

/** Lightweight — server does the real auth check; we just prevent blank submits. */
const loginPasswordValidator = yup
  .string()
  .required('Password is required.')
  .max(128, 'Password must be under 128 characters.');

/** Strict — mirrors backend passwordSchema exactly. */
const registerPasswordValidator = yup
  .string()
  .required('Password is required.')
  .min(12, 'Password must be at least 12 characters.')
  .max(128, 'Password must be under 128 characters.')
  .matches(/[A-Z]/, 'Password must contain at least one uppercase letter.')
  .matches(/[a-z]/, 'Password must contain at least one lowercase letter.')
  .matches(/[0-9]/, 'Password must contain at least one number.');

// ─── Login Schema ───────────────────────────────────────────────────────────

export const loginSchema = yup.object({
  username: usernameValidator,
  password: loginPasswordValidator,
});

// ─── Register Schema ────────────────────────────────────────────────────────

export const registerSchema = yup.object({
  nickname: yup
    .string()
    .required('Display name is required.')
    .max(254, 'Display name must be under 254 characters.')
    .trim(),
  username: usernameValidator,
  password: registerPasswordValidator,
  confirmPassword: yup
    .string()
    .required('Please confirm your password.')
    .oneOf([yup.ref('password')], "Passwords don't match."),
});

// ─── Types ──────────────────────────────────────────────────────────────────

export type LoginFields = yup.InferType<typeof loginSchema>;
export type RegisterFields = yup.InferType<typeof registerSchema>;
export type AuthFields = LoginFields & Pick<RegisterFields, 'nickname' | 'confirmPassword'>;

// ─── Helper: run a yup schema and return a flat error map ──────────────────
// Returns null if valid, otherwise { fieldName: 'first error message' }

export async function validateSchema<T extends object>(
  schema: yup.ObjectSchema<T>,
  values: unknown,
): Promise<Partial<Record<keyof T, string>> | null> {
  try {
    await schema.validate(values, { abortEarly: false, stripUnknown: true });
    return null; // ✅ valid
  } catch (err) {
    if (err instanceof yup.ValidationError) {
      const errors: Partial<Record<keyof T, string>> = {};
      for (const ve of err.inner) {
        const key = ve.path as keyof T;
        if (key && !errors[key]) {
          errors[key] = ve.message; // keep only the first error per field
        }
      }
      return errors;
    }
    throw err; // unexpected — bubble up
  }
}