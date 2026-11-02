import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button, Text } from "@cloudflare/kumo";
import { authClient } from "../lib/auth-client";
import { authErrorMessage } from "../lib/auth-errors";
import { toast } from "../lib/toast";
import AuthCard from "../components/auth-card";
import { AuthLink } from "../components/auth-link";
import { FormError } from "../components/form-error";

/** Seconds before another resend is allowed (and after a 429). */
const COOLDOWN = 30;
const RATE_LIMITED_COOLDOWN = 60;

export const Route = createFileRoute("/check-email")({
  // `reason=unverified` comes from sign-in: no email was sent yet this visit.
  validateSearch: (search: { email?: string; reason?: string }) => ({
    email: search.email ?? "",
    reason: search.reason === "unverified" ? ("unverified" as const) : undefined,
  }),
  component: CheckEmail,
});

function useCountdown(initial: number) {
  const [seconds, setSeconds] = useState(initial);
  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);
  return [seconds, setSeconds] as const;
}

function CheckEmail() {
  const { email, reason } = Route.useSearch();
  const unverified = reason === "unverified";
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Fresh sign-ups were just sent a link; make them wait before resending.
  const [cooldown, setCooldown] = useCountdown(unverified ? 0 : COOLDOWN);

  const send = async () => {
    setSending(true);
    setError(null);
    const r = await authClient.sendVerificationEmail({ email, callbackURL: "/" });
    setSending(false);
    if (r.error) {
      setError(authErrorMessage(r.error, "Couldn't send the email. Try again."));
      setAttempt((n) => n + 1);
      if (r.error.status === 429) setCooldown(RATE_LIMITED_COOLDOWN);
      return;
    }
    setSentCount((n) => n + 1);
    setCooldown(COOLDOWN);
    toast.success("Verification email sent", `Check ${email} for the link.`);
  };

  const label =
    cooldown > 0
      ? `Resend in ${cooldown}s`
      : unverified && sentCount === 0
        ? "Send verification email"
        : "Resend verification email";

  return (
    <AuthCard
      title={unverified ? "Verify your email" : "Check your email"}
      footer={
        <Text variant="secondary" size="sm">
          <AuthLink to="/sign-in">Back to sign in</AuthLink>
        </Text>
      }
    >
      <div className="text-center" role="status">
        <Text variant="secondary">
          {unverified && sentCount === 0
            ? `${email || "Your email"} isn't verified yet. Send a new link, then click it to finish signing in.`
            : `We sent a verification link${email ? ` to ${email}` : ""}. Click it to activate your account. Check spam if it doesn't arrive in a minute.`}
        </Text>
      </div>
      <FormError message={error} attempt={attempt} />
      {email && (
        <Button
          variant={unverified && sentCount === 0 ? "primary" : "secondary"}
          className="w-full justify-center"
          loading={sending}
          disabled={cooldown > 0}
          onClick={() => void send()}
        >
          {label}
        </Button>
      )}
    </AuthCard>
  );
}
