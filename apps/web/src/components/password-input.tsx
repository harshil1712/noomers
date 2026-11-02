import { useState, type ReactNode } from "react";
import { InputGroup } from "@cloudflare/kumo";
import { Eye, EyeSlash } from "@phosphor-icons/react";

/** Password field with a show/hide toggle (Kumo InputGroup). */
export function PasswordInput({
  label,
  value,
  onValueChange,
  autoComplete,
  description,
  error,
  invalid,
  minLength,
  required = true,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  description?: ReactNode;
  /** Field-level message shown under the input. */
  error?: string;
  /** Marks the input invalid without a field-level message (the form error explains it). */
  invalid?: boolean;
  minLength?: number;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <InputGroup
      label={label}
      description={description}
      error={error ? { message: error, match: true } : undefined}
    >
      <InputGroup.Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        aria-label={label}
        aria-invalid={invalid || Boolean(error) || undefined}
        spellCheck={false}
        autoCapitalize="none"
      />
      <InputGroup.Addon align="end">
        <InputGroup.Button
          className="text-kumo-subtle"
          icon={visible ? EyeSlash : Eye}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        />
      </InputGroup.Addon>
    </InputGroup>
  );
}
