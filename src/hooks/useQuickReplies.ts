import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

const DEFAULTS = [
  "Здравствуйте! Подскажите, удобно ли вам сейчас обсудить запись?",
  "Спасибо за заявку! Подтверждаю — записал вас. Что-то ещё уточнить?",
  "Понял вас. Чтобы предложить лучшее, уточните пожалуйста дату и время.",
  "У нас сейчас действует акция — могу зафиксировать за вами цену?",
];

type Row = { id: string; text: string; position: number };

export function useQuickReplies() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [seeded, setSeeded] = useState(false);

  const refetch = useCallback(async () => {
    if (!user?.id) { setRows([]); return; }
    const { data } = await supabase
      .from("quick_replies")
      .select("*")
      .eq("user_id", user.id)
      .order("position");
    setRows((data ?? []) as Row[]);
  }, [user?.id]);

  useEffect(() => { void refetch(); }, [refetch]);
  useRealtimeTable("quick_replies", refetch, !!user?.id);

  // seed defaults once for new users
  useEffect(() => {
    if (!user?.id || seeded) return;
    setSeeded(true);
    (async () => {
      const { count } = await supabase
        .from("quick_replies")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      if ((count ?? 0) === 0) {
        await supabase.from("quick_replies").insert(
          DEFAULTS.map((text, i) => ({ user_id: user.id, text, position: i })),
        );
        await refetch();
      }
    })();
  }, [user?.id, seeded, refetch]);

  const items = rows.map((r) => r.text);

  const add = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || !user?.id) return;
    const nextPos = (rows[rows.length - 1]?.position ?? -1) + 1;
    await supabase.from("quick_replies").insert({ user_id: user.id, text: t, position: nextPos });
    await refetch();
  }, [user?.id, rows, refetch]);

  const remove = useCallback(async (idx: number) => {
    const row = rows[idx];
    if (!row) return;
    await supabase.from("quick_replies").delete().eq("id", row.id);
    await refetch();
  }, [rows, refetch]);

  return { items, add, remove };
}
