import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Edit2, Eye, Globe, GitBranch, Link2, MessageCircle, Phone, Plus, Search, Trash2, UserCircle2, Users2, XCircle } from "lucide-react";
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
import { SiteIntakeCard } from "@/pages/SettingsConnection";
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

export default function Settings() {
  const { members, removeMember } = useTeamStore();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [query, setQuery] = useState("");
  const [confirmDel, setConfirmDel] = useState<TeamMember | null>(null);

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

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Настройки</h1>
          <p className="text-sm text-muted-foreground">Команда, воронки, телефония и личный профиль</p>
        </div>
      </div>

      <Tabs defaultValue="team" className="w-full">
        <TabsList className="mb-5 flex h-auto w-full flex-wrap justify-start gap-1 bg-card/40 p-1">
          <TabsTrigger value="team" className="gap-2"><Users2 className="h-3.5 w-3.5" /> Команда</TabsTrigger>
          <TabsTrigger value="profile" className="gap-2"><UserCircle2 className="h-3.5 w-3.5" /> Профиль</TabsTrigger>
          <TabsTrigger value="pipelines" className="gap-2"><GitBranch className="h-3.5 w-3.5" /> Воронки</TabsTrigger>
          <TabsTrigger value="loss" className="gap-2"><XCircle className="h-3.5 w-3.5" /> Причины отказа</TabsTrigger>
          <TabsTrigger value="telephony" className="gap-2"><Phone className="h-3.5 w-3.5" /> Телефония</TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-2"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</TabsTrigger>
          <TabsTrigger value="site" className="gap-2"><Globe className="h-3.5 w-3.5" /> Сайт</TabsTrigger>
          <TabsTrigger value="inbound" className="gap-2"><Link2 className="h-3.5 w-3.5" /> Лендинги</TabsTrigger>
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
    </div>
  );
}
