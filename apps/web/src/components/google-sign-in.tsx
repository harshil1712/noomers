import { useState } from "react";
import { Button } from "@cloudflare/kumo";
import { GoogleLogoIcon } from "@phosphor-icons/react";
import { authClient } from "../lib/auth-client";
import { usePublicConfig } from "../lib/public-config";
import { authErrorMessage } from "../lib/auth-errors";
import { toast } from "../lib/toast";

/** "Continue with Google" — renders nothing unless Google sign-in is configured. */
export function GoogleSignInButton() {
  const { googleEnabled } = usePublicConfig();
  const [loading, setLoading] = useState(false);
  if (!googleEnabled) return null;

  const start = async () => {
    setLoading(true);
    const r = await authClient.signIn.social({ provider: "google", callbackURL: "/dashboard" });
    // On success the browser is already leaving for Google.
    if (r.error) {
      toast.error("Couldn't start Google sign-in", authErrorMessage(r.error));
      setLoading(false);
    }
  };

  return (
    <Button
      variant="secondary"
      className="w-full justify-center"
      icon={GoogleLogoIcon}
      loading={loading}
      onClick={() => void start()}
    >
      Continue with Google
    </Button>
  );
}
