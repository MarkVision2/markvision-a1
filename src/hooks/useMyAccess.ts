import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { MODULES, defaultModulesForRole, type ModuleKey, type TeamRole } from "@/hooks/useTeamStore";

const ALL_MODULES = MODULES.map((m) => m.key);

/**
 * Доступы текущего пользователя к модулям.
 * Админ — всё. Остальные — по team_member_modules, при отсутствии записей
 * фоллбек на набор по роли из user_roles.
 */
export function useMyAccess() {
  const { user, loading: authLoading, isAdmin } = useAuth();
  const [modules, setModules] = useState<ModuleKey[] | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setModules([]);
      return;
    }
    if (isAdmin) {
      setModules(ALL_MODULES);
      return;
    }
    const [{ data: mods }, { data: roles }] = await Promise.all([
      supabase.from("team_member_modules").select("module_key").eq("user_id", user.id),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
    ]);
    const explicit = (mods ?? []).map((m) => m.module_key as ModuleKey);
    if (explicit.length) {
      setModules(explicit);
      return;
    }
    const role = (roles?.[0]?.role as TeamRole | undefined) ?? "viewer";
    setModules(defaultModulesForRole(role));
  }, [user, isAdmin]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  return useMemo(
    () => ({
      loading: authLoading || modules === null,
      isAdmin,
      modules: modules ?? [],
      has: (key: ModuleKey) => (isAdmin ? true : (modules ?? []).includes(key)),
    }),
    [authLoading, modules, isAdmin],
  );
}
