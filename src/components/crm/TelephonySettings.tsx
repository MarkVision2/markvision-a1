import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { invalidateTelephonyCache } from "@/lib/telephony";
import { toast } from "sonner";
import { Phone, Headphones, Server, PhoneForwarded } from "lucide-react";
import { useAutoSave } from "@/hooks/useAutoSave";
import { SaveStatusBadge } from "@/components/settings/SaveStatusBadge";

type Provider = "tel" | "sip" | "sipuni" | "binotel";

type TSettings = {
  telephony_provider: Provider;
  sipuni_user: string | null;
  sipuni_operator: string | null;
};

const PROVIDERS: { id: Provider; title: string; desc: string; icon: typeof Phone }[] = [
  { id: "tel", title: "Системный звонок", desc: "tel: — мобильный/FaceTime/системный dialer", icon: Phone },
  { id: "sip", title: "SIP-софтфон", desc: "sip: — Zoiper, MicroSIP, Sipuni Desktop", icon: Headphones },
  { id: "sipuni", title: "Sipuni АТС", desc: "Click-to-call: Sipuni звонит вам, потом клиенту", icon: Server },
  { id: "binotel", title: "Binotel АТС", desc: "Click-to-call: Binotel звонит вам, потом клиенту", icon: PhoneForwarded },
];

export function TelephonySettings() {
  const { isAdmin, user } = useAuth();
  const [s, setS] = useState<TSettings | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [extension, setExtension] = useState("");
  const [savingToken, setSavingToken] = useState(false);

  const load = async () => {
    const { data } = await (supabase.from("automation_settings" as any) as any)
      .select("telephony_provider, sipuni_user, sipuni_operator").eq("id", true).single();
    if (data) {
      setS(data as TSettings);
      markSavedSettings(data as TSettings);
    }
    if (user?.id) {
      const { data: p } = await (supabase.from("profiles") as any)
        .select("sip_extension").eq("id", user.id).single();
      const ext = p?.sip_extension ?? "";
      setExtension(ext);
      markSavedExt(ext);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);
  useRealtimeTable("automation_settings", () => void load());
  useRealtimeTable("profiles", () => void load(), !!user?.id);

  const update = (patch: Partial<TSettings>) => setS((p) => p ? { ...p, ...patch } : p);

  const { status: settingsStatus, error: settingsError, markSaved: markSavedSettings } = useAutoSave<TSettings | null>({
    value: s,
    enabled: !!s && isAdmin,
    delay: 700,
    onSave: async (v) => {
      if (!v) return;
      const { error } = await (supabase.from("automation_settings" as any) as any)
        .update({
          telephony_provider: v.telephony_provider,
          sipuni_user: v.sipuni_user,
          sipuni_operator: v.sipuni_operator,
        })
        .eq("id", true);
      if (error) throw error;
      invalidateTelephonyCache();
    },
  });

  const { status: extStatus, error: extError, markSaved: markSavedExt } = useAutoSave<string>({
    value: extension,
    enabled: !!user?.id,
    delay: 700,
    onSave: async (v) => {
      if (!user?.id) return;
      const { error } = await (supabase.from("profiles") as any)
        .update({ sip_extension: v.trim() || null }).eq("id", user.id);
      if (error) throw error;
    },
  });

  useEffect(() => { if (settingsError) toast.error(settingsError); }, [settingsError]);
  useEffect(() => { if (extError) toast.error(extError); }, [extError]);

  const saveToken = async () => {
    if (!isAdmin || !tokenInput.trim()) return;
    setSavingToken(true);
    const { error } = await supabase.rpc("save_sipuni_token" as never, { p_token: tokenInput.trim() } as never);
    setSavingToken(false);
    if (error) toast.error("Не сохранено: " + error.message);
    else { toast.success("Токен сохранён"); setTokenInput(""); invalidateTelephonyCache(); }
  };

  if (!s) return null;

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Телефония</h3>
          <p className="text-xs text-muted-foreground">Куда уходит клик «Позвонить» из карточки лида</p>
        </div>
        {isAdmin && <SaveStatusBadge status={settingsStatus} error={settingsError} />}
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        {PROVIDERS.map((p) => {
          const active = s.telephony_provider === p.id;
          const Icon = p.icon;
          return (
            <button
              key={p.id}
              type="button"
              disabled={!isAdmin}
              onClick={() => update({ telephony_provider: p.id })}
              className={cn(
                "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors",
                active ? "border-primary/60 bg-primary/10" : "border-border/60 bg-card/40 hover:bg-secondary/40",
                !isAdmin && "cursor-not-allowed opacity-60",
              )}
            >
              <div className="flex items-center gap-2">
                <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                <span className="text-sm font-semibold">{p.title}</span>
              </div>
              <span className="text-[11px] leading-snug text-muted-foreground">{p.desc}</span>
            </button>
          );
        })}
      </div>

      {s.telephony_provider === "sipuni" && isAdmin && (
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Sipuni User (ID)">
            <Input value={s.sipuni_user ?? ""} onChange={(e) => update({ sipuni_user: e.target.value })} placeholder="например 002344" />
          </Field>
          <Field label="API Token">
            <div className="flex gap-2">
              <Input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="оставьте пустым, если не меняете" />
              {tokenInput.trim() && (
                <Button size="sm" variant="outline" onClick={saveToken} disabled={savingToken}>
                  {savingToken ? "…" : "Сохранить"}
                </Button>
              )}
            </div>
          </Field>
          <Field label="Дефолтный оператор (внутр. номер)">
            <Input value={s.sipuni_operator ?? ""} onChange={(e) => update({ sipuni_operator: e.target.value })} placeholder="например 100" />
          </Field>
        </div>
      )}

      {s.telephony_provider === "sipuni" && !isAdmin && (
        <p className="text-xs text-muted-foreground">Параметры Sipuni может менять только администратор.</p>
      )}

      {s.telephony_provider === "binotel" && (
        <p className="text-xs text-muted-foreground">
          Ключи и номера Binotel настраиваются в разделе «Настройки → Телефония».
        </p>
      )}

      <div className="rounded-xl border border-border/60 bg-secondary/30 p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <Label className="block text-[11px] uppercase tracking-wide text-muted-foreground">Мой внутренний номер (для звонков через АТС)</Label>
          <SaveStatusBadge status={extStatus} error={extError} />
        </div>
        <Input value={extension} onChange={(e) => setExtension(e.target.value)} placeholder="например, 101" className="max-w-[200px]" />
        <p className="mt-1 text-[11px] text-muted-foreground">Если не указан — будет использован дефолтный номер из настроек Sipuni. Сохраняется автоматически.</p>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}