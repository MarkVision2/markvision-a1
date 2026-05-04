import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { UserCircle2 } from "lucide-react";
import { useAutoSave } from "@/hooks/useAutoSave";
import { SaveStatusBadge } from "./SaveStatusBadge";

export function ProfileSettings() {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [sipExt, setSipExt] = useState("");
  const [loading, setLoading] = useState(false);

  const load = () => {
    if (!user) return;
    setLoading(true);
    void supabase
      .from("profiles")
      .select("name, phone, sip_extension")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        if (data) {
          setName(data.name ?? "");
          setPhone(data.phone ?? "");
          setSipExt(data.sip_extension ?? "");
        }
        setLoading(false);
        // Reset autosave baseline so loaded data isn't treated as a change.
        markSaved({ name: data?.name ?? "", phone: data?.phone ?? "", sipExt: data?.sip_extension ?? "" });
      });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);
  useRealtimeTable("profiles", () => load(), !!user?.id);

  const value = useMemo(() => ({ name, phone, sipExt }), [name, phone, sipExt]);

  const { status, error, markSaved } = useAutoSave({
    value,
    enabled: !!user && !loading,
    delay: 700,
    onSave: async (v) => {
      if (!user) return;
      if (v.name.trim().length < 2) throw new Error("Имя слишком короткое");
      const { error: err } = await supabase
        .from("profiles")
        .update({
          name: v.name.trim(),
          phone: v.phone.trim() || null,
          sip_extension: v.sipExt.trim() || null,
        })
        .eq("id", user.id);
      if (err) throw err;
    },
  });

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  return (
    <section className="rounded-2xl border border-border/60 bg-card/40 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
            <UserCircle2 className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Мой профиль</h2>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <SaveStatusBadge status={status} error={error} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="p-name">Имя</Label>
          <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} disabled={loading} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-phone">Телефон</Label>
          <Input id="p-phone" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={loading} placeholder="+7 ..." />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-sip">SIP-extension</Label>
          <Input id="p-sip" value={sipExt} onChange={(e) => setSipExt(e.target.value)} disabled={loading} placeholder="например, 101" />
        </div>
      </div>
      <p className="mt-4 text-[11px] text-muted-foreground">Изменения сохраняются автоматически.</p>
    </section>
  );
}