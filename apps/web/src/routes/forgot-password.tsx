import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Input, Text } from "@cloudflare/kumo";
import { authClient } from "../lib/auth-client";
import { authErrorFields } from "../lib/auth-errors";
import { useCaptchaForm } from "../lib/use-captcha-form";
import AuthCard from "../components/auth-card";
import { AuthLink } from "../components/auth-link";
import { FormError } from "../components/form-error";

export const Route = createFileRoute("/forgot-password")({ component: ForgotPassword });

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  const form = useCaptchaForm(
    (headers) =>
      authClient.requestPasswordReset({ email, redirectTo: "/reset-password" }, { headers }),
    { onSuccess: () => setDone(true) },
  );

  const footer = (
    <Text variant="secondary" size="sm">
      <AuthLink to="/sign-in">Back to sign in</AuthLink>
    </Text>
  );

  if (done) {
    return (
      <AuthCard title="Check your email" footer={footer}>
        <div role="status" className="text-center">
          <Text variant="secondary">
            If {email} has an account, a reset link is on its way. Open it on this device to choose
            a new password.
          </Text>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset password"
      description="Enter your account email and we'll send you a reset link."
      footer={footer}
    >
      <form onSubmit={form.onSubmit} className="flex w-full flex-col gap-4">
        <Input
          label="Email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          aria-invalid={authErrorFields(form.error).has("email") || undefined}
        />
        {form.captcha}
        <FormError message={form.message} attempt={form.attempt} />
        <Button
          variant="primary"
          type="submit"
          className="w-full justify-center"
          loading={form.loading}
        >
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}
