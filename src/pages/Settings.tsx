import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Camera, CheckCircle2, Edit2, Eye, Globe, GitBranch, KeyRound, Link2, Loader2, MessageCircle, Phone, Plus, RefreshCw, Search, Trash2, UserCircle2, Users2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  "telephony", "whatsapp", "site", "inbound", "ig-organic", "meta-tokens", "clientview",
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number];
type ConnectionStatus = "connected" | "disconnected" | "checking";

const CONNECTION_SECTIONS: Array<{
  tab: SettingsTab;
  title: string;
  desc: string;
  icon: ComponentType<{ className?: string }>;
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
    desc: "Webhook для заявок с сайта и тест отправки.",
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
    title: "Instagram organic",
    desc: "Подключение органического Instagram проекта.",
    icon: Camera,
  },
  {
    tab: "meta-tokens",
    title: "Meta токен",
    desc: "Токены Meta API для рекламных данных.",
    icon: KeyRound,
  },
  {
    tab: "clientview",
    title: "Доступ клиента",
    desc: "Read-only ссылка клиента на дашборд.",
    icon: Eye,
  },
];

export default function Settings() {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const defaultTab: SettingsTab = SETTINGS_TABS.includes(tabParam as SettingsTab)
    ? (tabParam as SettingsTab)
    : "team";
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
        clientview: "checking",
      }));

      const [telephonyRes, waRes, igRes, metaRes, inboundRes, clientViewRes] = await Promise.all([
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
        clientview: clientViewConnected ? "connected" : "disconnected",
      }));
    };

    void loadConnectionStatus();
    return () => {
      cancelled = true;
    };
  }, [activeId, active?.intakeToken, statusRefreshTick]);

  return (
    <PageContainer>
      <PageHeader
        icon={SettingsIcon}
        title="Настройки"
        description="Команда, воронки и все подключения проекта в одном месте"
      />

      <section className="mt-6 rounded-2xl border border-border/60 bg-card/40 p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Карта подключений</h2>
            <p className="text-xs text-muted-foreground">
              Пройдите разделы по порядку: WhatsApp, сайт/лендинги, Instagram, Meta токен и клиентский доступ.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-lg"
            onClick={() => setStatusRefreshTick((v) => v + 1)}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Проверить ещё раз
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {CONNECTION_SECTIONS.map((s) => (
            <Link
              key={s.tab}
              to={`/settings?tab=${s.tab}`}
              className="rounded-xl border border-border/60 bg-background/40 p-3 transition-colors hover:bg-secondary/30"
            >
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
                  <s.icon className="h-4 w-4" />
                </span>
                <span className="text-sm font-medium">{s.title}</span>
                <span
                  className={cn(
                    "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    connectionStatus[s.tab] === "connected" && "bg-success/15 text-success",
                    connectionStatus[s.tab] === "disconnected" && "bg-muted text-muted-foreground",
                    connectionStatus[s.tab] === "checking" && "bg-primary/10 text-primary",
                  )}
                >
                  {connectionStatus[s.tab] === "connected" && <CheckCircle2 className="h-3 w-3" />}
                  {connectionStatus[s.tab] === "checking" && <Loader2 className="h-3 w-3 animate-spin" />}
                  {connectionStatus[s.tab] === "connected"
                    ? "Подключено"
                    : connectionStatus[s.tab] === "checking"
                      ? "Проверка"
                      : "Не настроено"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{s.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      <Tabs defaultValue={defaultTab} key={defaultTab} className="mt-6 w-full">
        <TabsList className="mb-5 flex h-auto w-full flex-wrap justify-start gap-1 bg-card/40 p-1">
          <TabsTrigger value="team" className="gap-2"><Users2 className="h-3.5 w-3.5" /> Команда</TabsTrigger>
          <TabsTrigger value="profile" className="gap-2"><UserCircle2 className="h-3.5 w-3.5" /> Профиль</TabsTrigger>
          <TabsTrigger value="pipelines" className="gap-2"><GitBranch className="h-3.5 w-3.5" /> Воронки</TabsTrigger>
          <TabsTrigger value="loss" className="gap-2"><XCircle className="h-3.5 w-3.5" /> Причины отказа</TabsTrigger>
          <TabsTrigger value="telephony" className="gap-2"><Phone className="h-3.5 w-3.5" /> Телефония</TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-2"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</TabsTrigger>
          <TabsTrigger value="site" className="gap-2"><Globe className="h-3.5 w-3.5" /> Сайт</TabsTrigger>
          <TabsTrigger value="inbound" className="gap-2"><Link2 className="h-3.5 w-3.5" /> Лендинги</TabsTrigger>
          <TabsTrigger value="ig-organic" className="gap-2"><Camera className="h-3.5 w-3.5" /> Instagram organic</TabsTrigger>
          <TabsTrigger value="meta-tokens" className="gap-2"><KeyRound className="h-3.5 w-3.5" /> Meta токен</TabsTrigger>
          <TabsTrigger value="clientview" className="gap-2"><Eye className="h-3.5 w-3.5" /> Доступ клиента</TabsTrigger>
        </TabsList>

        <TabsContent value="team" className="mt-0">
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
        </TabsContent>

        <TabsContent value="profile" className="mt-0">
          <ProfileSettings />
        </TabsContent>

        <TabsContent value="pipelines" className="mt-0">
          <PipelinesSettings />
        </TabsContent>

        <TabsContent value="loss" className="mt-0">
          <LossReasonsSettings />
        </TabsContent>

        <TabsContent value="telephony" className="mt-0">
          <SipuniSettings />
        </TabsContent>

        <TabsContent value="whatsapp" className="mt-0">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-success/15 text-success">
                <MessageCircle className="h-6 w-6" />
              </span>
              <div className="flex-1">
                <h3 className="text-base font-semibold">Подключение WhatsApp (Green API)</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Авторизуйте инстанс Green API через QR-код или по номеру телефона.
                </p>
              </div>
              <Button asChild>
                <Link to="/settings/connection">Открыть</Link>
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="site" className="mt-0">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="mb-4 flex items-start gap-4">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/15 text-primary">
                <Globe className="h-6 w-6" />
              </span>
              <div className="flex-1">
                <h3 className="text-base font-semibold">Заявки с сайта (Tilda и любая HTML-форма)</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Скопируйте URL вебхука и вставьте его в настройки формы на сайте. Каждая отправка создаст новую сделку в этапе «Новая» с UTM-метками и источником.
                </p>
              </div>
            </div>
            <SiteIntakeCard />
          </div>
        </TabsContent>

        <TabsContent value="ig-organic" className="mt-0">
          <InstagramOrganicSettings />
        </TabsContent>

        <TabsContent value="meta-tokens" className="mt-0">
          <MetaTokensSettings />
        </TabsContent>



        <TabsContent value="inbound" className="mt-0">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="mb-4 flex items-start gap-4">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/15 text-primary">
                <Link2 className="h-6 w-6" />
              </span>
              <div className="flex-1">
                <h3 className="text-base font-semibold">Лендинги и формы</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Создайте токен для каждого лендинга. Скопируйте HTML-сниппет — все заявки автоматически уйдут в нужного клиента/кабинет, с UTM, fbc/fbp и автоматическим CAPI Lead в Meta.
                </p>
              </div>
            </div>
            <InboundTokensSettings />
          </div>
        </TabsContent>

        <TabsContent value="clientview" className="mt-0">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="mb-4 flex items-start gap-4">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/15 text-primary">
                <Eye className="h-6 w-6" />
              </span>
              <div className="flex-1">
                <h3 className="text-base font-semibold">Доступ клиента к дашборду</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Создайте read-only ссылку для клиента: лиды, качество, конверсии, выручка. Без логина, без доступа к контактам и админке.
                </p>
              </div>
            </div>
            <ClientDashTokensSettings />
          </div>
        </TabsContent>
      </Tabs>

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
