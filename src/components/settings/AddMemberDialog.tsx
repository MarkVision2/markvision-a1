import { useEffect, useMemo, useState } from "react";
import { Copy, Eye, EyeOff, FolderKanban, RefreshCw, Shield, UserPlus2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  MODULES,
  ROLE_LABELS,
  TeamMember,
  TeamRole,
  defaultModulesForRole,
  useTeamStore,
} from "@/hooks/useTeamStore";


interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: TeamMember | null;
}

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AddMemberDialog({ open, onOpenChange, editing }: Props) {
  const { addMember, updateMember } = useTeamStore();
  const { projects } = useProjectsStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState(() => genPassword());
  const [showPwd, setShowPwd] = useState(false);
  const [role, setRole] = useState<TeamRole>("manager");
  const [modules, setModules] = useState<string[]>(defaultModulesForRole("manager"));
  const [projectIds, setProjectIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      if (editing) {
        setName(editing.name); setEmail(editing.email);
        setLogin(editing.login ?? ""); setPassword(editing.password ?? genPassword());
        setRole(editing.role); setModules(editing.modules);
        setProjectIds(editing.projects ?? []);
      } else {
        setName(""); setEmail(""); setLogin("");
        setPassword(genPassword()); setRole("manager");
        setModules(defaultModulesForRole("manager"));
        setProjectIds([]);
      }
    }
  }, [open, editing]);


  const handleRoleChange = (r: TeamRole) => {
    setRole(r);
    setModules(defaultModulesForRole(r));
  };

  const toggleModule = (key: string) => {
    setModules((m) => (m.includes(key) ? m.filter((k) => k !== key) : [...m, key]));
  };

  const allChecked = modules.length === MODULES.length;
  const counter = useMemo(() => `${modules.length}/${MODULES.length} модулей`, [modules]);

  const handleSubmit = () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (trimmedName.length < 2) {
      toast({ title: "Укажите имя сотрудника", description: "Минимум 2 символа", variant: "destructive" });
      return;
    }
    if (!EMAIL_RE.test(trimmedEmail)) {
      toast({ title: "Некорректный email", variant: "destructive" });
      return;
    }
    if (!password || password.length < 8) {
      toast({ title: "Слабый пароль", description: "Минимум 8 символов", variant: "destructive" });
      return;
    }
    if (modules.length === 0) {
      toast({ title: "Выберите хотя бы один модуль", variant: "destructive" });
      return;
    }
    const payload = {
      name: trimmedName,
      email: trimmedEmail,
      login: login.trim() || undefined,
      password,
      role,
      modules: modules as TeamMember["modules"],
    };
    if (editing) {
      updateMember(editing.id, payload);
      toast({ title: "Сотрудник обновлён" });
    } else {
      addMember(payload);
      toast({ title: "Сотрудник добавлен", description: `Доступ: ${ROLE_LABELS[role]}` });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Редактировать сотрудника" : "Добавить сотрудника"}</DialogTitle>
          <DialogDescription>Заполните данные и настройте доступы к модулям</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-success/15 text-success">
                <UserPlus2 className="h-3.5 w-3.5" />
              </span>
              Учётные данные
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="m-name">Имя</Label>
                <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Иван Иванов" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-email">Email</Label>
                <Input id="m-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ivan@example.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-login">Логин (без пробелов)</Label>
                <Input id="m-login" value={login} onChange={(e) => setLogin(e.target.value.replace(/\s+/g, "_"))} placeholder="ivan_doc" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-pwd">Временный пароль</Label>
                <div className="relative">
                  <Input
                    id="m-pwd"
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-20"
                  />
                  <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-1">
                    <button type="button" onClick={() => setShowPwd((v) => !v)} className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-secondary">
                      {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPassword(genPassword())}
                      className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-secondary"
                      aria-label="Сгенерировать новый"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(password); toast({ title: "Скопировано" }); }}
                      className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-secondary"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">Минимум 8 символов. Пользователь сможет сменить его при входе.</p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Роль</Label>
                <Select value={role} onValueChange={(v) => handleRoleChange(v as TeamRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-border/60 bg-card/40 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-success/15 text-success">
                  <Shield className="h-3.5 w-3.5" />
                </span>
                Права доступа
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">{counter}</span>
                <button
                  type="button"
                  onClick={() => setModules(allChecked ? [] : MODULES.map((m) => m.key))}
                  className="text-xs text-success hover:underline"
                >
                  {allChecked ? "Снять все" : "Выбрать все"}
                </button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {MODULES.map((m) => {
                const checked = modules.includes(m.key);
                return (
                  <label
                    key={m.key}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                      checked ? "border-success/50 bg-success/5" : "border-border/60 hover:bg-secondary/40"
                    }`}
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggleModule(m.key)} />
                    <span className="text-sm">{m.label}</span>
                  </label>
                );
              })}
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={handleSubmit}>{editing ? "Сохранить" : "Добавить"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
