/** The error shape Better Auth's client returns (`result.error`). */
export interface AuthErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

export const GENERIC_ERROR = "Something went wrong. Please try again.";
export const RESET_LINK_INVALID = "This reset link has expired or was already used.";

const MESSAGES = {
  INVALID_EMAIL_OR_PASSWORD: "That email and password don't match an account.",
  EMAIL_NOT_VERIFIED: "Verify your email before signing in. We can send you a new link.",
  USER_ALREADY_EXISTS: "An account with this email already exists. Sign in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "An account with this email already exists. Sign in instead.",
  INVALID_EMAIL: "That email address doesn't look right.",
  PASSWORD_TOO_SHORT: "Use at least 8 characters for your password.",
  PASSWORD_TOO_LONG: "That password is too long.",
  INVALID_PASSWORD: "That password isn't right.",
  INVALID_TOKEN: RESET_LINK_INVALID,
  TOKEN_EXPIRED: RESET_LINK_INVALID,
  SESSION_EXPIRED: "For your security, sign out and sign in again, then retry.",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "This account signs in with Google, so it has no password.",
  EMAIL_ALREADY_VERIFIED: "This email is already verified. You can sign in.",
  MISSING_RESPONSE: "Complete the security check, then try again.",
  VERIFICATION_FAILED: "The security check didn't pass. Try again.",
  BANNED_USER: "This account has been suspended.",
} satisfies Record<string, string>;

/** Turn a Better Auth error into a sentence a person can act on. */
export function authErrorMessage(
  error: AuthErrorLike | null | undefined,
  fallback: string = GENERIC_ERROR,
): string {
  if (!error) return fallback;
  if (error.status === 429) return "Too many attempts. Wait a minute, then try again.";
  if (error.code && error.code in MESSAGES) return MESSAGES[error.code as keyof typeof MESSAGES];
  // Raw codes ("SOME_CODE") aren't sentences — fall back instead of showing them.
  if (error.message && !/^[A-Z][A-Z0-9_]*$/.test(error.message)) return error.message;
  return fallback;
}

export type AuthField = "name" | "email" | "password";

/** Which form fields an error points at — drives `aria-invalid`. */
export function authErrorFields(error: AuthErrorLike | null | undefined): Set<AuthField> {
  switch (error?.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return new Set(["email", "password"]);
    case "INVALID_EMAIL":
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return new Set(["email"]);
    case "PASSWORD_TOO_SHORT":
    case "PASSWORD_TOO_LONG":
    case "INVALID_PASSWORD":
      return new Set(["password"]);
    default:
      return new Set();
  }
}
