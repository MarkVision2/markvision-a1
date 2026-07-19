import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Camera, CheckCircle2, Edit2, Eye, Globe, GitBranch, KeyRound, Link2, Loader2, MessageCircle, Phone, Plus, RefreshCw, Search, Trash2, UserCircle2, Users2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AddMemberDialog } from "@/components/settings/AddMemberDialog";
import { SipuniSettings } from "@/components/settings/SipuniSettings";
import { ProfileSettings } from "@/components/settings/ProfileSettings";
import { PipelinesSettings } from "@/components/settings/PipelinesSettings";
import { LossReasonsSettings } from "@/components/settings/LossReasonsSettings";
import { InboundTokensSettings } from "@/components/settings/InboundTokensSettings";
import { ClientDashTokensSettings } from "@/components/settings/ClientDashTokensSettings";
import { InstagramOrganicSettings } from "@/components/settings/InstagramOrganicSettings";
import { MetaTokensSettings } from "@/components/settings/MetaTokensSettings";
import { FacebookConnect } from "@/components/settings/FacebookConnect";
import { GoogleAdsConnect } from "@/components/settings/GoogleAdsConnect";
import { SiteIntakeCard } from "@/pages/SettingsConnection";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Settings as SettingsIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { clientConfigSupabase } from "@/integrations/clientConfig/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  MODULES,
  ROLE_LABELS,
  TeamMember,
  useTeamStore,
} from "@/hooks/useTeamStore";
import { toast } from "sonner";

const ROLE_COLOR: Record<string, string> = {
  admin: "bg-destructive/15 text-destructive border-destructive/40",
  director: "bg-warning/15 text-warning border-warning/40",
  manager: "bg-primary/15 text-primary border-primary/40",
  marketer: "bg-success/15 text-success border-success/40",
  viewer: "bg-muted text-muted-foreground border-border",
};

const SETTINGS_TABS = [
  "team", "profile", "pipelines", "loss",
  "telephony", "whatsapp", "site", "inbound", "ig-organic", "meta-tokens", "google-ads", "clientview",
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number];
type ConnectionStatus = "connected" | "disconnected" | "checking";

const PROJECT_NAV: Array<{ tab: SettingsTab; title: string; icon: LucideIcon }> = [
  { tab: "team", title: "Команда", icon: Users2 },
  { tab: "profile", title: "Профиль", icon: UserCircle2 },
  { tab: "pipelines", title: "Воронки", icon: GitBranch },
  { tab: "loss", title: "Причины отказа", icon: XCircle },
];

const CONNECTION_NAV: Array<{
  tab: SettingsTab;
  title: string;
  desc: string;
  icon: LucideIcon;
}> = [
  {
    tab: "telephony",
    title: "Телефония",
    desc: "SIP/звонки и базовые параметры коммуникаций.",
    icon: Phone,
  },
  {
    tab: "whatsapp",
    title: "WhatsApp",
    desc: "Привязка Green API, QR/код и webhook CRM.",
    icon: MessageCircle,
  },
  {
    tab: "site",
    title: "Сайт",
    desc: "Готовый код для передачи заявок из Lovable в CRM.",
    icon: Globe,
  },
  {
    tab: "inbound",
    title: "Лендинги",
    desc: "Токены и HTML-сниппеты для форм и страниц.",
    icon: Link2,
  },
  {
    tab: "ig-organic",
    title: "Instagram",
    desc: "Органический Instagram проекта: код-слова, вебхуки, связь с контент-аналитикой.",
    icon: Camera,
  },
  {
    tab: "meta-tokens",
    title: "Meta",
    desc: "Вход через Facebook и токены Meta API для рекламы и автопостинга.",
    icon: KeyRound,
  },
  {
    tab: "google-ads",
    title: "Google Ads",
    desc: "Вход через Google: рекламный кабинет, расходы и конверсии в сквозную аналитику проекта.",
    icon: Search,
  },
  {
    tab: "clientview",
    title: "Доступ клиента",
    desc: "Read-only ссылка клиента на дашборд.",
    icon: Eye,
  },
];

function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  if (status === "checking") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    );
  }
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
        <CheckCircle2 className="h-3 w-3" />
      </span>
    );
  }
  return <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40" title="Не настроено" />;
}

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: SettingsTab = SETTINGS_TABS.includes(tabParam as SettingsTab)
    ? (tabParam as SettingsTab)
    : "team";
  const setActiveTab = (tab: SettingsTab) => setSearchParams({ tab });
  const { members, removeMember } = useTeamStore();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [query, setQuery] = useState("");
  const [confirmDel, setConfirmDel] = useState<TeamMember | null>(null);
  const [statusRefreshTick, setStatusRefreshTick] = useState(0);
  const { activeId, active } = useProjectsStore();
  const [connectionStatus, setConnectionStatus] = useState<Record<SettingsTab, ConnectionStatus>>({
    team: "disconnected",
    profile: "disconnected",
    pipelines: "disconnected",
    loss: "disconnected",
    telephony: "checking",
    whatsapp: "checking",
    site: "checking",
    inbound: "checking",
    "ig-organic": "checking",
    "meta-tokens": "checking",
    "google-ads": "checking",
    clientview: "checking",
  });

  const handleEdit = (m: TeamMember) => { setEditing(m); setOpen(true); };
  const handleAdd = () => { setEditing(null); setOpen(true); };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        (m.login ?? "").toLowerCase().includes(q),
    );
  }, [members, query]);

  const confirmDelete = () => {
    if (!confirmDel) return;
    removeMember(confirmDel.id);
    toast.success(`Сотрудник «${confirmDel.name}» удалён`);
    setConfirmDel(null);
  };

  useEffect(() => {
    let cancelled = false;

    const loadConnectionStatus = async () => {
      if (!activeId) {
        if (!cancelled) {
          setConnectionStatus((prev) => ({
            ...prev,
            telephony: "disconnected",
            whatsapp: "disconnected",
            site: "disconnected",
            inbound: "disconnected",
            "ig-organic": "disconnected",
            "meta-tokens": "disconnected",
            "google-ads": "disconnected",
            clientview: "disconnected",
          }));
        }
        return;
      }

      setConnectionStatus((prev) => ({
        ...prev,
        telephony: "checking",
        whatsapp: "checking",
        site: "checking",
        inbound: "checking",
        "ig-organic": "checking",
        "meta-tokens": "checking",
        "google-ads": "checking",
        clientview: "checking",
      }));

      const [telephonyRes, waRes, igRes, metaRes, googleRes, inboundRes, clientViewRes] = await Promise.all([
        supabase
          .from("automation_settings" as never)
          .select("sipuni_enabled,sipuni_token_present")
          .limit(1)
          .maybeSingle(),
        supabase
          .from("whatsapp_config_safe")
          .select("id_instance,api_token_present,connected")
          .eq("project_id", activeId)
          .maybeSingle(),
        supabase
          .from("instagram_accounts_safe")
          .select("ig_user_id,active")
          .eq("project_id", activeId)
          .maybeSingle(),
        supabase
          .from("meta_tokens" as never)
          .select("id")
          .eq("project_id", activeId)
          .eq("is_active", true)
          .limit(1),
        supabase
          .from("ad_cabinets_safe" as never)
          .select("id")
          .eq("project_id", activeId)
          .eq("provider", "google")
          .limit(1),
        clientConfigSupabase
          ? clientConfigSupabase
              .from("inbound_tokens")
              .select("token")
              .eq("is_active", true)
              .limit(1)
          : Promise.resolve({ data: null, error: null }),
        clientConfigSupabase
          ? clientConfigSupabase
              .from("client_dashboard_tokens")
              .select("token")
              .eq("is_active", true)
              .limit(1)
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (cancelled) return;

      const telephonyData = telephonyRes.data as { sipuni_enabled?: boolean; sipuni_token_present?: boolean } | null;
      const telephonyConnected = !!(telephonyData?.sipuni_enabled && telephonyData?.sipuni_token_present);
      const waConnected = !!(waRes.data?.id_instance && waRes.data?.api_token_present && waRes.data?.connected);
      const siteConnected = !!active?.intakeToken;
      const igConnected = !!(igRes.data?.ig_user_id && igRes.data?.active);
      const metaConnected = !!(metaRes.data && metaRes.data.length > 0);
      const googleConnected = !!((googleRes.data as unknown[] | null) && (googleRes.data as unknown[]).length > 0);
      const inboundConnected = !!(inboundRes.data && inboundRes.data.length > 0);
      const clientViewConnected = !!(clientViewRes.data && clientViewRes.data.length > 0);

      setConnectionStatus((prev) => ({
        ...prev,
        telephony: telephonyConnected ? "connected" : "disconnected",
        whatsapp: waConnected ? "connected" : "disconnected",
        site: siteConnected ? "connected" : "disconnected",
        inbound: inboundConnected ? "connected" : "disconnected",
        "ig-organic": igConnected ? "connected" : "disconnected",
        "meta-tokens": metaConnected ? "connected" : "disconnected",
        "google-ads": googleConnected ? "connected" : "disconnected",
        clientview: clientViewConnected ? "connected" : "disconnected",
      }));
    };

    void loadConnectionStatus();
    return () => {
      cancelled = true;
    };
  }, [activeId, active?.intakeToken, statusRefreshTick]);

  const connectedCount = useMemo(
    () => CONNECTION_NAV.filter((s) => connectionStatus[s.tab] === "connected").length,
    [connectionStatus],
  );

  const activeConnection = CONNECTION_NAV.find((s) => s.tab === activeTab);

  const navButton = (tab: SettingsTab, title: string, Icon: LucideIcon, showStatus?: boolean) => (
    <button
      key={tab}
      type="button"
      onClick={() => setActiveTab(tab)}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
        activeTab === tab
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {showStatus && <ConnectionStatusBadge status={connectionStatus[tab]} />}
    </button>
  );

  return (
    <PageContainer>
      <PageHeader
        icon={SettingsIcon}
        title="Настройки"
        description="Слева — разделы проекта и интеграций. Справа — настройки выбранного пункта."
      />

      <div className="mt-6 flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(220px,260px)_1fr] lg:items-start">
        <aside className="space-y-4 rounded-2xl border border-border/60 bg-card/40 p-3 lg:sticky lg:top-4">
          <div>
            <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Проект</p>
            <nav className="mt-1 space-y-0.5">
              {PROJECT_NAV.map(({ tab, title, icon }) => navButton(tab, title, icon))}
            </nav>
          </div>

          <div className="border-t border-border/50 pt-3">
            <div className="flex items-center justify-between gap-2 px-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Подключения</p>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                title="Обновить статусы"
                onClick={() => setStatusRefreshTick((v) => v + 1)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="mt-1 px-2 text-[11px] text-muted-foreground">
              {connectedCount} из {CONNECTION_NAV.length} готово
            </p>
            <nav className="mt-2 space-y-0.5">
              {CONNECTION_NAV.map(({ tab, title, icon }) => navButton(tab, title, icon, true))}
            </nav>
          </div>
        </aside>

        <div className="min-w-0">
          {activeConnection && (
            <div className="mb-4 rounded-xl border border-border/50 bg-card/30 px-4 py-3">
              <h2 className="text-base font-semibold">{activeConnection.title}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{activeConnection.desc}</p>
            </div>
          )}

          {activeTab === "team" && (
      <section className="rounded-2xl border border-border/60 bg-card/40 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-success/15 text-success">
              <Users2 className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold">Сотрудники</h2>
              <p className="text-xs text-muted-foreground">
                {members.length} активных{query && ` · найдено ${filtered.length}`}
              </p>
            </div>
          </div>
          <Button onClick={handleAdd} className="gap-2">
            <Plus className="h-4 w-4" /> Добавить сотрудника
          </Button>
        </div>

        {members.length > 0 && (
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по имени, email или логину…"
              className="pl-9"
            />
          </div>
        )}

        {members.length === 0 ? (
          <div className="grid place-items-center rounded-xl border border-dashed border-border/60 py-14 text-center">
            <Users2 className="mb-3 h-8 w-8 text-muted-foreground/60" />
            <div className="text-sm font-medium">Сотрудников пока нет</div>
            <div className="mb-4 max-w-sm text-xs text-muted-foreground">
              Добавьте сотрудника, выберите роль и отметьте модули, к которым у него будет доступ.
            </div>
            <Button onClick={handleAdd} variant="outline" className="gap-2">
              <Plus className="h-4 w-4" /> Пригласить
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="grid place-items-center rounded-xl border border-dashed border-border/60 py-10 text-center text-xs text-muted-foreground">
            По запросу «{query}» ничего не найдено
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((m) => (
              <div
                key={m.id}
                className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-xl border border-border/60 bg-background/40 p-3.5 transition-colors hover:bg-secondary/30"
              >
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-success/15 text-sm font-bold text-success">
                  {m.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold">{m.name}</span>
                    <Badge variant="outline" className={ROLE_COLOR[m.role]}>{ROLE_LABELS[m.role]}</Badge>
                    {m.login && (
                      <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        @{m.login}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{m.email}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.modules.length === MODULES.length ? (
                      <span className="rounded-md border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] text-success">
                        Полный доступ
                      </span>
                    ) : (
                      m.modules.slice(0, 6).map((k) => {
                        const mod = MODULES.find((mm) => mm.key === k);
                        if (!mod) return null;
                        return (
                          <span key={k} className="rounded-md border border-border/60 bg-secondary/50 px-2 py-0.5 text-[10px] text-muted-foreground">
                            {mod.label}
                          </span>
                        );
                      })
                    )}
                    {m.modules.length > 6 && m.modules.length < MODULES.length && (
                      <span className="rounded-md bg-secondary/50 px-2 py-0.5 text-[10px] text-muted-foreground">
                        +{m.modules.length - 6}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => handleEdit(m)} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Редактировать">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button onClick={() => setConfirmDel(m)} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Удалить">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
          )}

          {activeTab === "profile" && <ProfileSettings />}

          {activeTab === "pipelines" && <PipelinesSettings />}

          {activeTab === "loss" && <LossReasonsSettings />}

          {activeTab === "telephony" && <SipuniSettings />}

          {activeTab === "whatsapp" && (
            <div className="rounded-2xl border border-border bg-card p-6">
              <p className="mb-4 text-sm text-muted-foreground">
                Авторизуйте инстанс Green API через QR-код или по номеру телефона. Сообщения попадут в CRM проекта.
              </p>
              <Button asChild>
                <Link to="/settings/connection">Открыть мастер подключения</Link>
              </Button>
            </div>
          )}

          {activeTab === "site" && <SiteIntakeCard />}

          {activeTab === "ig-organic" && <InstagramOrganicSettings />}

          {activeTab === "meta-tokens" && (
            <div className="space-y-6">
              <FacebookConnect />
              <MetaTokensSettings />
            </div>
          )}

          {activeTab === "google-ads" && <GoogleAdsConnect />}

          {activeTab === "inbound" && <InboundTokensSettings />}

          {activeTab === "clientview" && <ClientDashTokensSettings />}
        </div>
      </div>

      <AddMemberDialog open={open} onOpenChange={setOpen} editing={editing} />

      <AlertDialog open={!!confirmDel} onOpenChange={(v) => !v && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить сотрудника?</AlertDialogTitle>
            <AlertDialogDescription>
              Сотрудник «{confirmDel?.name}» потеряет доступ к выбранным модулям. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
