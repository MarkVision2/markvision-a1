import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

export type TeamRole = "admin" | "director" | "manager" | "marketer" | "viewer";

export const ROLE_LABELS: Record<TeamRole, string> = {
  admin: "Админ",
  director: "Директор",
  manager: "Менеджер",
  marketer: "Маркетолог",
  viewer: "Наблюдатель",
};

export const ROLE_DESCRIPTIONS: Record<TeamRole, string> = {
  admin: "Полный доступ ко всем разделам, настройкам и команде.",
  director: "Контроль показателей, финансов и отчётности без операционной CRM.",
  manager: "Работа с CRM, заявками и отчётами по своим проектам.",
  marketer: "Реклама, контент, аналитика и отчёты без финансовых настроек.",
  viewer: "Только просмотр дашборда и отчётов.",
};

export type ModuleKey =
  | "dashboard"
  // Маркетинг
  | "ads"
  | "factory"
  | "content_center"
  | "content_plan"
  | "strategy"
  // Продажи
  | "crm"
  | "sales_ai"
  | "ai_agents"
  | "broadcasts"
  | "leadgen"
  // Аналитика
  | "metrics"
  | "analytics"
  | "creative_funnel"
  | "content_analytics"
  // Финансы и отчёты
  | "finance"
  | "reports"
  // Система
  | "settings";

/** Доступы гранулярны: один пункт меню = один модуль. group — для группировки в форме. */
export const MODULES: { key: ModuleKey; label: string; group: string }[] = [
  { key: "dashboard", label: "Дашборд", group: "Главное" },
  { key: "ads", label: "Управление рекламой", group: "Маркетинг" },
  { key: "factory", label: "Контент-завод", group: "Маркетинг" },
  { key: "content_center", label: "Контент-центр", group: "Маркетинг" },
  { key: "content_plan", label: "Контент-план", group: "Маркетинг" },
  { key: "strategy", label: "Стратегия", group: "Маркетинг" },
  { key: "crm", label: "CRM", group: "Продажи" },
  { key: "sales_ai", label: "AI РОП", group: "Продажи" },
  { key: "ai_agents", label: "AI агенты", group: "Продажи" },
  { key: "broadcasts", label: "Рассылка", group: "Продажи" },
  { key: "leadgen", label: "Лидген", group: "Продажи" },
  { key: "metrics", label: "Таблица показателей", group: "Аналитика" },
  { key: "analytics", label: "Сквозная аналитика", group: "Аналитика" },
  { key: "creative_funnel", label: "Воронка по креативам", group: "Аналитика" },
  { key: "content_analytics", label: "Контент-аналитика", group: "Аналитика" },
  { key: "finance", label: "Финансы", group: "Финансы и отчёты" },
  { key: "reports", label: "Отчётность", group: "Финансы и отчёты" },
  { key: "settings", label: "Настройки", group: "Система" },
];

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  login?: string;
  password?: string; // только для передачи в edge-функцию при создании, не хранится
  role: TeamRole;
  modules: ModuleKey[];
  /** id проектов, к которым у пользователя есть доступ (project_members) */
  projects: string[];
  createdAt: string;
};


export function defaultModulesForRole(role: TeamRole): ModuleKey[] {
  switch (role) {
    case "admin":
      return MODULES.map((m) => m.key);
    case "director":
      return ["dashboard", "analytics", "metrics", "finance", "reports"];
    case "manager":
      return ["dashboard", "crm", "reports"];
    case "marketer":
      return ["dashboard", "ads", "factory", "content_center", "content_plan", "analytics", "metrics", "reports"];
    case "viewer":
      return ["dashboard", "reports"];
  }
}

const TEAM_ROLES = new Set<TeamRole>(["admin", "director", "manager", "marketer", "viewer"]);

function asTeamRole(value: unknown): TeamRole | null {
  return typeof value === "string" && TEAM_ROLES.has(value as TeamRole)
    ? (value as TeamRole)
    : null;
}

function systemRoleFor(role: TeamRole): "admin" | "manager" {
  return role === "admin" ? "admin" : "manager";
}

async function describeFunctionError(error: unknown): Promise<string> {
  if (
    error &&
    typeof error === "object" &&
    "context" in error &&
    (error as { context?: unknown }).context instanceof Response
  ) {
    const response = (error as { context: Response }).context.clone();
    try {
      const body = (await response.json()) as { error?: unknown; message?: unknown };
      const message = typeof body.error === "string"
        ? body.error
        : typeof body.message === "string"
          ? body.message
          : "";
      if (message) return message;
    } catch {
      const text = await response.text().catch(() => "");
      if (text) return text;
    }
  }
  return error instanceof Error ? error.message : "Неизвестная ошибка";
}

export function useTeamStore() {
  const { activeId: activeProjectId } = useProjectsStore();
  const [members, setMembers] = useState<TeamMember[]>([]);

  const refetch = useCallback(async () => {
    const [{ data: profiles }, { data: roles }, { data: modules }, { data: memberships }] =
      await Promise.all([
        supabase.from("profiles").select("id, name, login, display_role, created_at"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("team_member_modules").select("user_id, module_key"),
        supabase.from("project_members").select("user_id, project_id"),
      ]);

    // get emails via auth metadata is not accessible client-side; we leave email empty
    // (admin pages don't strictly need it; can be added later via edge function)
    const roleByUser = new Map<string, TeamRole>();
    (roles ?? []).forEach((r: { user_id: string; role: string }) => {
      const role = asTeamRole(r.role);
      if (role) roleByUser.set(r.user_id, role);
    });
    const modsByUser = new Map<string, ModuleKey[]>();
    (modules ?? []).forEach((m: { user_id: string; module_key: string }) => {
      const arr = modsByUser.get(m.user_id) ?? [];
      arr.push(m.module_key as ModuleKey);
      modsByUser.set(m.user_id, arr);
    });
    const projectsByUser = new Map<string, string[]>();
    (memberships ?? []).forEach((pm: { user_id: string; project_id: string }) => {
      const arr = projectsByUser.get(pm.user_id) ?? [];
      arr.push(pm.project_id);
      projectsByUser.set(pm.user_id, arr);
    });

    const list: TeamMember[] = (profiles ?? []).reduce<TeamMember[]>((acc, p: any) => {
      const userProjects = projectsByUser.get(p.id) ?? [];
      const role = asTeamRole(p.display_role) ?? roleByUser.get(p.id) ?? "manager";
      const isProjectMember = !!activeProjectId && userProjects.includes(activeProjectId);
      const isProjectWideAdmin = role === "admin";

      if (!isProjectMember && !isProjectWideAdmin) return acc;

      acc.push({
        id: p.id,
        name: p.name ?? "",
        email: "",
        login: p.login ?? undefined,
        role,
        modules: modsByUser.get(p.id) ?? defaultModulesForRole(role),
        projects: userProjects,
        createdAt: p.created_at,
      });
      return acc;
    }, []);
    setMembers(list);
  }, [activeProjectId]);

  useEffect(() => { void refetch(); }, [refetch]);
  useRealtimeTable("profiles", refetch);
  useRealtimeTable("user_roles", refetch);
  useRealtimeTable("team_member_modules", refetch);
  useRealtimeTable("project_members", refetch);

  const addMember = useCallback(async (m: Omit<TeamMember, "id" | "createdAt">) => {
    // create real auth user via edge function (admin only)
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: {
        email: m.email,
        password: m.password ?? Math.random().toString(36).slice(2) + "Aa1!",
        name: m.name,
        login: m.login,
        role: m.role,
        modules: m.modules,
        project_ids: m.projects ?? [],
      },
    });
    if (error) throw new Error(await describeFunctionError(error));
    await refetch();
    return { ...m, id: (data as { id: string }).id, createdAt: new Date().toISOString() };
  }, [refetch]);


  const updateMember = useCallback(async (id: string, patch: Partial<TeamMember>) => {
    const profilePatch: { name?: string; login?: string | null; display_role?: string | null } = {};
    if (patch.name !== undefined) profilePatch.name = patch.name;
    if (patch.login !== undefined) profilePatch.login = patch.login || null;
    if (patch.role !== undefined) profilePatch.display_role = patch.role;
    if (Object.keys(profilePatch).length) {
      const { error } = await supabase.from("profiles").update(profilePatch).eq("id", id);
      if (error) throw error;
    }
    if (patch.role !== undefined) {
      const { error: deleteError } = await supabase.from("user_roles").delete().eq("user_id", id);
      if (deleteError) throw deleteError;
      const systemRole = systemRoleFor(patch.role);
      const { error: insertError } = await supabase.from("user_roles").insert({ user_id: id, role: systemRole });
      if (insertError) throw insertError;
    }
    if (patch.modules !== undefined) {
      const { error: deleteError } = await supabase.from("team_member_modules").delete().eq("user_id", id);
      if (deleteError) throw deleteError;
      if (patch.modules.length) {
        const { error: insertError } = await supabase.from("team_member_modules").insert(
          patch.modules.map((mod) => ({ user_id: id, module_key: mod })),
        );
        if (insertError) throw insertError;
      }
    }
    if (patch.projects !== undefined) {
      const { error: deleteError } = await supabase.from("project_members").delete().eq("user_id", id);
      if (deleteError) throw deleteError;
      if (patch.projects.length) {
        const { error: insertError } = await supabase.from("project_members").insert(
          patch.projects.map((projectId) => ({
            project_id: projectId,
            user_id: id,
            role: "member",
          })),
        );
        if (insertError) throw insertError;
      }
    }

    await refetch();
  }, [refetch]);

  const removeMember = useCallback(async (id: string) => {
    // delete the auth user via edge function — cascades to profile/roles via FKs/cleanup
    await supabase.functions.invoke("admin-delete-user", { body: { user_id: id } });
    await refetch();
  }, [refetch]);

  // Реально меняет пароль auth-пользователя (пароль нельзя достать — только задать новый).
  const resetPassword = useCallback(async (id: string, password: string) => {
    const { error } = await supabase.functions.invoke("admin-reset-password", {
      body: { user_id: id, password },
    });
    if (error) throw new Error(await describeFunctionError(error));
  }, []);

  return { members, addMember, updateMember, removeMember, resetPassword };
}
