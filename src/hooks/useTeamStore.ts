import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

export type TeamRole = "admin" | "director" | "manager" | "marketer" | "viewer";

export const ROLE_LABELS: Record<TeamRole, string> = {
  admin: "Админ",
  director: "Директор",
  manager: "Менеджер",
  marketer: "Маркетолог",
  viewer: "Наблюдатель",
};

export type ModuleKey =
  | "dashboard"
  | "ads"
  | "factory"
  | "crm"
  | "analytics"
  | "metrics"
  | "finance"
  | "reports"
  | "settings";

export const MODULES: { key: ModuleKey; label: string }[] = [
  { key: "dashboard", label: "Дашборд" },
  { key: "ads", label: "Управление рекламой" },
  { key: "factory", label: "Контент-завод" },
  { key: "crm", label: "CRM" },
  { key: "analytics", label: "Сквозная аналитика" },
  { key: "metrics", label: "Таблица показателей" },
  { key: "finance", label: "Финансы" },
  { key: "reports", label: "Отчётность" },
  { key: "settings", label: "Настройки" },
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
      return ["dashboard", "ads", "factory", "analytics", "metrics", "reports"];
    case "viewer":
      return ["dashboard", "reports"];
  }
}

export function useTeamStore() {
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
      roleByUser.set(r.user_id, r.role as TeamRole);
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

    const list: TeamMember[] = (profiles ?? []).map((p: any) => {
      const role = roleByUser.get(p.id) ?? "manager";
      return {
        id: p.id,
        name: p.name ?? "",
        email: "",
        login: p.login ?? undefined,
        role,
        modules: modsByUser.get(p.id) ?? defaultModulesForRole(role),
        projects: projectsByUser.get(p.id) ?? [],
        createdAt: p.created_at,
      };
    });
    setMembers(list);
  }, []);

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
    if (error) throw error;
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
      const { error: insertError } = await supabase.from("user_roles").insert({ user_id: id, role: patch.role });
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

  return { members, addMember, updateMember, removeMember };
}
