import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { useT } from "@/i18n/useT";
import type { InvitePreview } from "@/lib/api";

interface Props {
  /** Who the typed username resolved to (display name and avatar only), or null when no confirmation is open. */
  preview: InvitePreview | null;
  /** What they are invited to, e.g. `the quest "Flat share"` or `the party "Night Owls"`. */
  target: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/** "Invite Bob Smith?" with their picture, shown before an invitation is really sent, so a mistyped username cannot reach the wrong person. */
export const InviteConfirmDialog = ({ preview, target, onCancel, onConfirm }: Props) => {
  const t = useT();
  return (
  <ConfirmDialog
    open={preview !== null}
    onOpenChange={(open) => !open && onCancel()}
    title={t("invite.title", { name: preview?.name ?? t("invite.thisPerson") })}
    description={
      <div className="flex items-center gap-3">
        {preview?.avatarUrl ? (
          <img src={preview.avatarUrl} alt="" width={48} height={48} className="h-12 w-12 rounded-full bg-background-secondary" referrerPolicy="no-referrer" />
        ) : (
          <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-primary-text">
            {(preview?.name ?? "?").slice(0, 1).toUpperCase()}
          </span>
        )}
        <p>
          <span className="font-medium text-foreground">{preview?.name ?? t("invite.thisPersonStart")}</span>{t("invite.body", { target })}
        </p>
      </div>
    }
    confirmLabel={t("invite.send")}
    cancelLabel={t("invite.notThem")}
    onConfirm={onConfirm}
  />
  );
};
