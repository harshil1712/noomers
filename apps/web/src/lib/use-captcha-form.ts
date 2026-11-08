import { createElement, useState, type FormEvent, type ReactNode } from "react";
import { TurnstileWidget } from "../components/turnstile";
import { usePublicConfig } from "./public-config";
import { authErrorMessage, type AuthErrorLike } from "./auth-errors";

type CaptchaHeaders = { "x-captcha-response": string };

interface Options<R> {
  /** Runs after a submit that returned no error (navigate, show "done"…). */
  onSuccess?: (result: R) => void | Promise<void>;
  /** Message for errors that have no friendlier mapping. */
  fallback?: string;
}

/**
 * Shared state for Turnstile-protected auth forms (sign-in, sign-up,
 * forgot-password): captcha token, loading, error and the submit wrapper.
 *
 * Tokens are single-use, so the widget remounts after every failed submit.
 *
 * @example
 * const form = useCaptchaForm((headers) => authClient.signIn.email({ email, password }, { headers }));
 * <form onSubmit={form.onSubmit}>… {form.captcha} <FormError message={form.message} attempt={form.attempt} /> …</form>
 */
export function useCaptchaForm<R extends { error?: AuthErrorLike | null }>(
  submit: (headers: CaptchaHeaders) => Promise<R>,
  { onSuccess, fallback }: Options<R> = {},
) {
  const { turnstileSiteKey } = usePublicConfig();
  const [token, setToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthErrorLike | null>(null);
  // Bumps on every failed submit so FormError re-announces and re-focuses
  // even when the message text is unchanged.
  const [attempt, setAttempt] = useState(0);

  const fail = (e: AuthErrorLike) => {
    setError(e);
    setAttempt((n) => n + 1);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    if (turnstileSiteKey && !token) {
      fail({ code: "MISSING_RESPONSE" });
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await submit({ "x-captcha-response": token ?? "" });
      if (result.error) {
        fail(result.error);
        setToken(null);
        setCaptchaKey((k) => k + 1);
        return;
      }
      await onSuccess?.(result);
    } catch {
      fail({});
      setToken(null);
      setCaptchaKey((k) => k + 1);
    } finally {
      setLoading(false);
    }
  };

  const captcha: ReactNode = createElement(TurnstileWidget, { key: captchaKey, onToken: setToken });

  return {
    onSubmit: (e: FormEvent<HTMLFormElement>) => void onSubmit(e),
    loading,
    error,
    message: error ? authErrorMessage(error, fallback) : null,
    attempt,
    captcha,
  };
}
