import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { CosmeticItem, CosmeticKind } from "@/lib/api";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/feedback/ErrorCard";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { AvatarFrame } from "@/components/game/AvatarFrame";
import { useAuth, getAvatarUrl } from "@/contexts/AuthContext";
import { useBuyCosmetic, useCosmetics, useEquipCosmetic } from "@/hooks/useApi";
import { nextTabIndex } from "@/lib/tabs";
import { cn } from "@/lib/utils";

const TABS: Array<{ kind: CosmeticKind; label: string; blurb: string }> = [
  { kind: "title", label: "Titles", blurb: "A title shows next to your name on the leaderboard, your profile and the sidebar." },
  { kind: "frame", label: "Frames", blurb: "A ring around your avatar wherever it appears." },
  { kind: "accent", label: "Accents", blurb: "Colours your name on your own profile page." },
];

/** What the item looks like: a sample name for titles, a ring for frames, a swatch for accents. */
const Preview = ({ item, name, avatarUrl }: { item: CosmeticItem; name: string; avatarUrl: string }) => {
  if (item.kind === "title") {
    return (
      <p className="truncate text-sm font-semibold">
        {name} <span className="text-[0.6875rem] font-medium italic text-foreground-muted">{item.name}</span>
      </p>
    );
  }
  if (item.kind === "frame") {
    return (
      <AvatarFrame frame={{ id: item.id, name: item.name, color: item.color ?? "transparent" }}>
        <img src={avatarUrl} alt="" className="h-12 w-12 rounded-full border-2 border-card object-cover" />
      </AvatarFrame>
    );
  }
  return (
    <div className="cos-accent" style={{ "--cos-accent-light": item.color, "--cos-accent-dark": item.colorDark ?? item.color } as React.CSSProperties}>
      <p className="cos-accent-text truncate text-lg font-heading font-bold">{name}</p>
      <div className="cos-accent-bar mt-1 h-1 w-16 rounded-full" aria-hidden />
    </div>
  );
};

const Shop = () => {
  const { user } = useAuth();
  const { data, isLoading, isError, error, refetch, isFetching } = useCosmetics();
  const buy = useBuyCosmetic();
  const equip = useEquipCosmetic();
  const [kind, setKind] = useState<CosmeticKind>("title");
  const [confirm, setConfirm] = useState<CosmeticItem | null>(null);

  const discord = user?.discord;
  const name = discord?.globalName || discord?.username || "Adventurer";
  const avatarUrl = getAvatarUrl(discord?.discordId || "0", discord?.avatar || null);
  const balance = data?.balance ?? 0;
  const items = useMemo(() => (data?.items ?? []).filter((i) => i.kind === kind), [data, kind]);
  // Only the button whose request is in flight shows a spinner / is disabled.
  const buyingId = buy.isPending ? buy.variables : undefined;
  const equippingId = equip.isPending ? equip.variables?.id ?? `none-${equip.variables?.kind}` : undefined;

  const handleBuy = async (item: CosmeticItem) => {
    try {
      await buy.mutateAsync(item.id);
      toast.success(`Bought ${item.name}.`);
    } catch {
      /* error toast shown by the mutation hook */
    }
  };

  const handleEquip = async (item: CosmeticItem | null, k: CosmeticKind) => {
    try {
      await equip.mutateAsync({ kind: k, id: item ? item.id : null });
      toast.success(item ? `Equipped ${item.name}.` : "Unequipped.");
    } catch {
      /* error toast shown by the mutation hook */
    }
  };

  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    const next = nextTabIndex(e.key, index, TABS.length);
    if (next === null) return;
    e.preventDefault();
    setKind(TABS[next].kind);
    document.getElementById(`shop-tab-${TABS[next].kind}`)?.focus();
  };

  return (
    <DashboardLayout>
      <div className="mb-6 sm:mb-8">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="mb-2 text-2xl font-heading font-bold sm:text-3xl">Shop</h1>
          <p className="text-sm text-foreground-muted sm:text-base">Spend XP on titles, avatar frames and profile colours. They never change how you earn XP, and you keep them when you prestige.</p>
        </motion.div>
      </div>

      <div className="mb-6 inline-flex items-center gap-2 rounded-xl border border-border bg-card p-3 sm:gap-3 sm:p-4">
        <Sparkles className="h-4 w-4 text-xp sm:h-5 sm:w-5" aria-hidden />
        <span className="text-sm text-foreground-muted">Available XP:</span>
        <span className="text-lg font-heading font-bold text-xp sm:text-xl">{isLoading ? "…" : balance.toLocaleString()}</span>
      </div>

      {isError ? (
        <ErrorCard what="the shop" error={error} onRetry={() => void refetch()} retrying={isFetching} />
      ) : (
        <>
          <div role="tablist" aria-label="Shop sections" className="mb-2 flex gap-1 rounded-xl border border-border bg-card p-1 sm:inline-flex">
            {TABS.map((t, i) => (
              <button
                key={t.kind}
                id={`shop-tab-${t.kind}`}
                type="button"
                role="tab"
                aria-selected={kind === t.kind}
                aria-controls="shop-panel"
                tabIndex={kind === t.kind ? 0 : -1}
                onClick={() => setKind(t.kind)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={cn("flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors sm:flex-none", kind === t.kind ? "bg-primary text-primary-foreground" : "text-foreground-muted hover:text-foreground")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="mb-4 text-sm text-foreground-muted">{TABS.find((t) => t.kind === kind)?.blurb}</p>

          <div id="shop-panel" role="tabpanel" aria-labelledby={`shop-tab-${kind}`}>
            {isLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[...Array(6)].map((_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-card/50" />)}
              </div>
            ) : (
              <>
                {data && !data.gamificationEnabled && (
                  <p className="mb-4 rounded-lg border border-border bg-card p-3 text-sm text-foreground-muted">XP is turned off in Settings, so buying is unavailable.</p>
                )}
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((item) => (
                    <li key={item.id} className={cn("flex flex-col rounded-2xl border-2 bg-card p-4", item.equipped ? "border-primary" : "border-border")}>
                      <div className="mb-3 flex min-h-14 items-center">
                        <Preview item={item} name={name} avatarUrl={avatarUrl} />
                      </div>
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h2 className="font-heading font-semibold">{item.name}</h2>
                        {item.owned ? (
                          <span className="flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs text-success"><Check className="h-3 w-3" aria-hidden /> Owned</span>
                        ) : (
                          <span className="flex items-center gap-1 rounded-full bg-background-secondary px-2 py-0.5 text-xs text-foreground-muted">
                            {item.locked && <Lock className="h-3 w-3" aria-hidden />} {item.cost.toLocaleString()} XP
                          </span>
                        )}
                      </div>
                      {item.locked && item.lockedReason && <p className="mb-3 text-xs text-foreground-muted">Locked: {item.lockedReason}.</p>}
                      <div className="mt-auto">
                        {item.equipped ? (
                          <Button variant="secondary" size="sm" className="w-full" disabled={equippingId === `none-${item.kind}`} onClick={() => void handleEquip(null, item.kind)}>
                            {equippingId === `none-${item.kind}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Unequip"}
                          </Button>
                        ) : item.owned ? (
                          <Button variant="glow" size="sm" className="w-full" disabled={equippingId === item.id} onClick={() => void handleEquip(item, item.kind)}>
                            {equippingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Equip"}
                          </Button>
                        ) : (
                          <Button
                            variant={item.affordable ? "xp" : "secondary"}
                            size="sm"
                            className="w-full"
                            disabled={item.locked || !item.affordable || !data?.gamificationEnabled || buyingId === item.id}
                            onClick={() => setConfirm(item)}
                          >
                            {buyingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : item.locked ? "Locked" : item.affordable ? `Buy for ${item.cost.toLocaleString()} XP` : `Need ${(item.cost - balance).toLocaleString()} more XP`}
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={`Buy ${confirm?.name ?? "this item"}?`}
        description={confirm && (
          <div className="space-y-1 text-sm">
            <p>Price: <span className="font-semibold text-xp">{confirm.cost.toLocaleString()} XP</span></p>
            <p>Balance after: <span className="font-semibold">{Math.max(0, balance - confirm.cost).toLocaleString()} XP</span></p>
          </div>
        )}
        confirmLabel={`Spend ${confirm?.cost.toLocaleString() ?? ""} XP`}
        onConfirm={() => { if (confirm) void handleBuy(confirm); setConfirm(null); }}
      />
    </DashboardLayout>
  );
};

export default Shop;
