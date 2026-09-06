/**
 * «Роли в проекте» (RBAC): кто имеет доступ к проекту и с какой ролью. Роль
 * участника меняет владелец или администратор; владельца поменять нельзя.
 * Матрица уровней — _lib/rbac.ts, зеркало roleAllows в publishingClient.
 */
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PROJECT_ROLE_LABELS, publishingApi, roleAllows, type ProjectMember, type ProjectRole } from "@/lib/publishingClient";

const LEVELS = [
  { level: "read", label: "Смотреть" },
  { level: "operate", label: "Повторять задания, проверять аккаунты" },
  { level: "publish", label: "Публиковать, кампании" },
  { level: "manage", label: "Аккаунты, группы, настройки, ключи, вебхуки" },
  { level: "admin", label: "Назначать роли" },
] as const;

export function ProjectRolesSection({ projectId, role }: { projectId: string | null; role: ProjectRole | null }) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [assignable, setAssignable] = useState<ProjectRole[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) { setMembers([]); return; }
    try {
      const r = await publishingApi.memberList(projectId);
      setMembers(r.members ?? []);
      setAssignable(r.assignable ?? []);
    } catch { /* секция вторична */ }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const setRole = async (m: ProjectMember, next: ProjectRole) => {
    if (!projectId) return;
    setBusy(m.user_id);
    try {
      await publishingApi.memberRoleSet(projectId, m.user_id, next);
      toast.success(`Роль: ${PROJECT_ROLE_LABELS[next]}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  };

  if (!projectId) return null;
  const canEdit = roleAllows(role, "admin");

  return (
    <section className="rounded-2xl border p-4">
      <div className="mb-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" /> Роли в проекте</h3>
        <p className="text-xs text-muted-foreground">
          Ваша роль: <b>{role ? PROJECT_ROLE_LABELS[role] : "—"}</b>. Уровни вложены: {LEVELS.map((l) => l.label.toLowerCase()).join(" → ")}.
          Участник без явной роли получает роль по глобальной роли команды.
        </p>
      </div>
      {!members.length ? <p className="text-sm text-muted-foreground">Участников нет.</p> : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9">Участник</TableHead>
                <TableHead className="h-9">Глобальная роль</TableHead>
                <TableHead className="h-9 w-[220px]">Роль в проекте</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const explicit = (["admin", "manager", "content_manager", "operator", "viewer"] as ProjectRole[]).find((r) => r === m.member_role) ?? null;
                return (
                  <TableRow key={m.user_id}>
                    <TableCell className="py-2 text-sm">
                      {m.name || m.user_id.slice(0, 8)}
                      {m.is_owner && <Badge variant="outline" className="ml-2 border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">владелец</Badge>}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">{m.global_role ?? "—"}</TableCell>
                    <TableCell className="py-2">
                      {m.is_owner ? (
                        <span className="text-sm">{PROJECT_ROLE_LABELS.owner}</span>
                      ) : canEdit ? (
                        <Select value={explicit ?? "__inherit__"} onValueChange={(v) => { if (v !== "__inherit__") void setRole(m, v as ProjectRole); }} disabled={busy === m.user_id}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__inherit__">По глобальной роли</SelectItem>
                            {assignable.filter((r) => r !== "admin" || role === "owner").map((r) => <SelectItem key={r} value={r}>{PROJECT_ROLE_LABELS[r]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-sm">{explicit ? PROJECT_ROLE_LABELS[explicit] : "по глобальной роли"}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
