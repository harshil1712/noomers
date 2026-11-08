import { useState, type ReactElement, type ReactNode } from "react";
import { Button, Dialog } from "@cloudflare/kumo";

/**
 * Confirmation step for consequential actions (Kumo Dialog, alertdialog role).
 *
 * Use `trigger` for the self-contained form, or `open`/`onOpenChange` when the
 * action starts somewhere else (e.g. a DropdownMenu item). `onConfirm` may be
 * async; the confirm button shows a spinner meanwhile. Return `false` to keep
 * the dialog open (e.g. to show an error inside it).
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  variant = "primary",
  onConfirm,
  trigger,
  open,
  onOpenChange,
  confirmDisabled,
  children,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "primary" | "destructive";
  onConfirm: () => void | Promise<void | false | undefined>;
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  confirmDisabled?: boolean;
  /** Extra content between the description and the buttons (e.g. a password field). */
  children?: ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isOpen = open ?? internalOpen;

  const setOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await onConfirm();
      if (result !== false) setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root
      role="alertdialog"
      open={isOpen}
      onOpenChange={(next: boolean) => {
        if (!busy) setOpen(next);
      }}
    >
      {trigger && <Dialog.Trigger render={trigger} />}
      <Dialog className="flex flex-col gap-4 p-6">
        <Dialog.Title className="text-lg font-semibold text-kumo-default">{title}</Dialog.Title>
        <Dialog.Description className="text-kumo-subtle">{description}</Dialog.Description>
        {children}
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Dialog.Close
            disabled={busy}
            render={<Button variant="secondary">{cancelLabel}</Button>}
          />
          <Button
            variant={variant}
            loading={busy}
            disabled={confirmDisabled}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
