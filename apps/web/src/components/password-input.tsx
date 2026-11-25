import { InputGroup } from "@cloudflare/kumo";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { useState } from "react";

export function PasswordInput({
  label,
  value,
  onValueChange,
  autoComplete,
  minLength,
  description,
  error,
  invalid,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  description?: string;
  error?: string;
  invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <InputGroup
      label={label}
      description={description}
      error={error ? { message: error, match: true } : undefined}
      required
    >
      <InputGroup.Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        autoComplete={autoComplete}
        minLength={minLength}
        required
        aria-invalid={invalid || !!error || undefined}
      />
      <InputGroup.Addon align="end">
        <InputGroup.Button
          type="button"
          variant="ghost"
          icon={visible ? EyeSlash : Eye}
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          onClick={() => setVisible((v) => !v)}
        />
      </InputGroup.Addon>
    </InputGroup>
  );
}
