import { betterAuth } from "better-auth";
import { admin, captcha, oAuthProxy } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as authSchema from "../src/auth-schema";
import { PRODUCT } from "../src/config";
import { sendAuthEmail, verifyEmailTemplate, resetPasswordTemplate } from "./email";
import { assertTurnstileConfig } from "./turnstile-guard";

/** Owner bootstrap: verified-email match only (a social provider sets
 * verified; unverified signups never promote). */
export function bootstrapAdmin<T extends { email?: string; emailVerified?: boolean }>(
  user: T,
  ownerEmail: string,
): T {
  if (
    ownerEmail &&
    user.emailVerified === true &&
    user.email?.toLowerCase() === ownerEmail.toLowerCase()
  ) {
    return { ...user, role: "admin" } as T;
  }
  return user;
}

export function createAuth(env: Env) {
  assertTurnstileConfig(env.TURNSTILE_SECRET_KEY, env.BETTER_AUTH_URL);
  const db = drizzle(env.DB, { schema: authSchema });

  // Register Google only when real credentials exist — an empty provider
  // breaks sign-in otherwise.
  const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
  // Per-deployment switch: close NEW sign-ups, keep sign-in working.
  const signupDisabled = env.SIGNUP_DISABLED === "true";
  const socialProviders = googleEnabled
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          disableSignUp: signupDisabled,
        },
      }
    : {};

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, { provider: "sqlite" }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      disableSignUp: signupDisabled,
      sendResetPassword: async ({ user, url }) => {
        const t = resetPasswordTemplate(url);
        await sendAuthEmail(env, { to: user.email, ...t });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const t = verifyEmailTemplate(url);
        await sendAuthEmail(env, { to: user.email, ...t });
      },
    },
    socialProviders,
    // Self-service account deletion (Settings → Delete account). Better Auth
    // requires the password for credential users, or a fresh session.
    user: {
      deleteUser: {
        enabled: true,
        afterDelete: async () => {},
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({ data: bootstrapAdmin(user, env.OWNER_ADMIN_EMAIL) }),
        },
      },
      session: {
        create: {
          // Password sign-ups verify after create — by the time the first
          // session exists the user row is verified, so promote the owner here
          // (user.create covers social sign-ups, which verify at create).
          before: async (session, context) => {
            const adapter = context?.context?.adapter;
            if (adapter && env.OWNER_ADMIN_EMAIL) {
              const u = await adapter.findOne<{
                id: string;
                email: string;
                emailVerified: boolean;
                role: string | null;
              }>({ model: "user", where: [{ field: "id", value: session.userId }] });
              if (
                u?.emailVerified &&
                u.email.toLowerCase() === env.OWNER_ADMIN_EMAIL.toLowerCase() &&
                u.role !== "admin"
              ) {
                await adapter.update({
                  model: "user",
                  where: [{ field: "id", value: u.id }],
                  update: { role: "admin" },
                });
              }
            }
            return { data: session };
          },
        },
      },
    },
    plugins: [
      captcha({
        provider: "cloudflare-turnstile",
        secretKey: env.TURNSTILE_SECRET_KEY ?? "",
        endpoints: [
          "/sign-up/email",
          "/sign-in/email",
          "/forget-password",
          "/request-password-reset",
        ],
      }),
      admin(),
      // Google sign-in on preview deployments: proxies OAuth through
      // production's registered redirect URI. No-op on the production URL.
      oAuthProxy({
        productionURL: `https://${PRODUCT.appDomain}`,
        currentURL: env.OAUTH_PROXY_URL || env.BETTER_AUTH_URL,
        secret: env.OAUTH_PROXY_SECRET || undefined,
      }),
    ],
  });
}
