import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Banner, Button, Input, Text } from "@cloudflare/kumo";
import { authClient } from "../lib/auth-client";
import { loadPublicConfig } from "../lib/public-config";
import { authErrorFields } from "../lib/auth-errors";
import { useCaptchaForm } from "../lib/use-captcha-form";
import AuthCard from "../components/auth-card";
import { AuthLink } from "../components/auth-link";
import { FormError } from "../components/form-error";
import { GoogleSignInButton } from "../components/google-sign-in";
import { SensitiveInput } from "@cloudflare/kumo";

export const Route = createFileRoute("/sign-up")({
  component: SignUp,
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (session?.user) throw redirect({ to: "/dashboard" });
    if (!(await loadPublicConfig()).signupEnabled) {
      throw redirect({ to: "/sign-in", search: { notice: undefined } });
    }
  },
});

function SignUp() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const form = useCaptchaForm(
    (headers) =>
      authClient.signUp.email(
        { name: name.trim(), email, password, callbackURL: "/" },
        { headers },
      ),
    {
      fallback: "Sign-up failed. Please try again.",
      // Email verification is required — no session yet; land on the inbox page.
      onSuccess: () => navigate({ to: "/check-email", search: { email, reason: undefined } }),
    },
  );
  const exists =
    form.error?.code === "USER_ALREADY_EXISTS" ||
    form.error?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL";

  return (
    <AuthCard
      title="Create account"
      footer={
        <Text variant="secondary" size="sm">
          Already have an account? <AuthLink to="/sign-in">Sign in</AuthLink>
        </Text>
      }
    >
      <form onSubmit={form.onSubmit} className="flex w-full flex-col gap-4">
        <Input
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
        />
        <Input
          label="Email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          aria-
        />
        <SensitiveInput
          label="Password"
          description="At least 8 characters"
          value={password}
          onValueChange={setPassword}
          autoComplete="new-password"
          minLength={8}
        />
        {form.captcha}
        <FormError
          message={form.message}
          attempt={form.attempt}
          action={
            exists ? (
              <Banner.Action
                variant="secondary"
                onClick={() => void navigate({ to: "/sign-in", search: { notice: undefined } })}
              >
                Sign in
              </Banner.Action>
            ) : undefined
          }
        />
        <Button
          variant="primary"
          type="submit"
          className="w-full justify-center"
          loading={form.loading}
        >
          Create account
        </Button>
      </form>
      <GoogleSignInButton />
    </AuthCard>
  );
}
