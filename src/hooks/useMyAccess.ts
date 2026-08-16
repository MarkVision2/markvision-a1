import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { MODULES, defaultModulesForRole, type ModuleKey, type TeamRole } from "@/hooks/useTeamStore";

const ALL_MODULES = MODULES.map((m) => m.key);

/**
 * Доступы текущего пользователя к модулям.
 * Явно выбранные модули всегда приоритетны, в том числе для админа.
 * При отсутствии записей используется набор по роли.
 */
export function useMyAccess() {
  const { user, loading: authLoading, isAdmin } = useAuth();
  const [modules, setModules] = useState<ModuleKey[] | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setModules([]);
      return;
    }
    const [{ data: mods, error: modulesError }, { data: roles, error: rolesError }] = await Promise.all([
      supabase.from("team_member_modules").select("module_key").eq("user_id", user.id),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
    ]);
    if (modulesError || rolesError) {
      console.error("Не удалось загрузить права пользователя", modulesError ?? rolesError);
      setModules([]);
      return;
    }
    const explicit = (mods ?? []).map((m) => m.module_key as ModuleKey);
    if (explicit.length) {
      setModules(explicit);
      return;
    }
    if (isAdmin) {
      setModules(ALL_MODULES);
      return;
    }
    const role = (roles?.[0]?.role as TeamRole | undefined) ?? "viewer";
    setModules(defaultModulesForRole(role));
  }, [user, isAdmin]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  useRealtimeTable("team_member_modules", load);
  useRealtimeTable("user_roles", load);

  return useMemo(
    () => ({
      loading: authLoading || modules === null,
      isAdmin,
      modules: modules ?? [],
      has: (key: ModuleKey) => (modules ?? []).includes(key),
    }),
    [authLoading, modules, isAdmin],
  );
}
