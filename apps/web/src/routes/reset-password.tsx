import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Banner, Button, Link, LinkButton, Text } from "@cloudflare/kumo";
import { WarningCircle } from "@phosphor-icons/react";
import { authClient } from "../lib/auth-client";
import { authErrorMessage, RESET_LINK_INVALID, type AuthErrorLike } from "../lib/auth-errors";
import AuthCard from "../components/auth-card";
import { AuthLink } from "../components/auth-link";
import { FormError } from "../components/form-error";
import { PasswordInput } from "../components/password-input";

export const Route = createFileRoute("/reset-password")({
  // Better Auth sends `?token=…` for a good link and `?error=INVALID_TOKEN`
  // when the link has expired or was already used.
  validateSearch: (search: { token?: string; error?: string }) => ({
    token: search.token ?? "",
    error: search.error ?? "",
  }),
  component: ResetPassword,
});

const TOKEN_ERRORS = new Set(["INVALID_TOKEN", "TOKEN_EXPIRED"]);

function ResetPassword() {
  const { token, error: linkError } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<AuthErrorLike | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);

  const footer = (
    <Text variant="secondary" size="sm">
      <AuthLink to="/sign-in">Back to sign in</AuthLink>
    </Text>
  );

  if (linkError || !token) {
    return (
      <AuthCard title="Link not valid" footer={footer}>
        <Banner
          variant="error"
          size="sm"
          icon={<WarningCircle weight="fill" size={16} aria-hidden />}
          description={
            linkError
              ? RESET_LINK_INVALID
              : "This reset link is incomplete. Copy the whole link from the email, or request a new one."
          }
        />
        <LinkButton href="/forgot-password" variant="primary" className="w-full justify-center">
          Request a new link
        </LinkButton>
      </AuthCard>
    );
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await authClient
      .resetPassword({ newPassword: password, token })
      .catch(() => null);
    if (!result) {
      setError({ message: "Request failed. Check your connection and try again." } as never);
      setLoading(false);
      return;
    }
    if (result.error) {
      setError(result.error);
      setAttempt((n) => n + 1);
      setLoading(false);
      return;
    }
    await navigate({ to: "/sign-in", search: { notice: "password-reset" } });
  };

  const tokenProblem = Boolean(error?.code && TOKEN_ERRORS.has(error.code));

  return (
    <AuthCard title="Choose a new password" footer={footer}>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex w-full flex-col gap-4">
        <PasswordInput
          label="New password"
          description="At least 8 characters"
          value={password}
          onValueChange={setPassword}
          autoComplete="new-password"
          minLength={8}
          invalid={error?.code === "PASSWORD_TOO_SHORT" || error?.code === "PASSWORD_TOO_LONG"}
        />
        <FormError
          message={
            error ? authErrorMessage(error, "Couldn't reset your password. Try again.") : null
          }
          attempt={attempt}
          action={
            tokenProblem ? <Link href="/forgot-password">Request a new link</Link> : undefined
          }
        />
        <Button variant="primary" type="submit" className="w-full justify-center" loading={loading}>
          Reset password
        </Button>
      </form>
    </AuthCard>
  );
}
