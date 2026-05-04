import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Plus, Trash2, XCircle, GripVertical } from "lucide-react";

type Reason = { id: string; key: string; label: string; emoji: string | null; order_index: number };

export function LossReasonsSettings() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState<Reason[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [newEmoji, setNewEmoji] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("loss_reasons")
      .select("id, key, label, emoji, order_index")
      .order("order_index", { ascending: true });
    if (error) toast.error(error.message);
    else setItems((data ?? []) as Reason[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);
  useRealtimeTable("loss_reasons", () => void load());

  const add = async () => {
    const label = newLabel.trim();
    if (!label) { toast.error("Введите причину"); return; }
    const key = label.toLowerCase().replace(/\s+/g, "_").replace(/[^\w]/g, "").slice(0, 40) || `r_${Date.now()}`;
    const order_index = items.length ? Math.max(...items.map((i) => i.order_index)) + 1 : 0;
    const { error } = await supabase.from("loss_reasons").insert({
      key, label, emoji: newEmoji.trim() || null, order_index,
    });
    if (error) { toast.error(error.message); return; }
    setNewLabel(""); setNewEmoji("");
    await load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("loss_reasons").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { setItems((prev) => prev.filter((i) => i.id !== id)); toast.success("Удалено"); }
  };

  return (
    <section className="rounded-2xl border border-border/60 bg-card/40 p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-destructive/15 text-destructive">
          <XCircle className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold">Причины отказа</h2>
          <p className="text-xs text-muted-foreground">Используются при закрытии лида со статусом «Отказ»</p>
        </div>
      </div>

      {!isAdmin && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Только администратор может добавлять и удалять причины.
        </div>
      )}

      <div className="mb-4 grid gap-2 sm:grid-cols-[80px_1fr_auto]">
        <Input placeholder="🚫" value={newEmoji} onChange={(e) => setNewEmoji(e.target.value)} maxLength={4} disabled={!isAdmin} />
        <Input placeholder="Например, Дорого" value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()} disabled={!isAdmin} />
        <Button onClick={add} className="gap-2" disabled={!isAdmin}>
          <Plus className="h-4 w-4" /> Добавить
        </Button>
      </div>

      {loading ? (
        <div className="py-6 text-center text-xs text-muted-foreground">Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-border/60 py-10 text-center text-xs text-muted-foreground">
          Список пуст. Добавьте первую причину выше.
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((r) => (
            <div key={r.id} className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <GripVertical className="h-4 w-4 text-muted-foreground/50" />
              <span className="text-lg leading-none">{r.emoji ?? "•"}</span>
              <div className="min-w-0">
                <div className="truncate text-sm">{r.label}</div>
                <div className="truncate text-[10px] text-muted-foreground">{r.key}</div>
              </div>
              <button
                onClick={() => remove(r.id)}
                disabled={!isAdmin}
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                aria-label="Удалить"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}