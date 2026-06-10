import { useCallback, useEffect, useState } from "react";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { fetchProjectsRows, type ProjectRow } from "@/lib/fetchProjectsRows";
import {
  isMissingCreativeUsernameColumn,
  PROJECTS_BASE_COLUMNS,
  PROJECTS_LIST_COLUMNS,
} from "@/lib/projectColumns";

const ACTIVE_PROJECT_CHANGED_EVENT = "markvision:active-project-changed";
let activeProjectIdSnapshot = "";
const activeProjectSubscribers = new Set<(id: string) => void>();
let optimisticActiveProjectId: string | null = null;
let optimisticActiveProjectUntil = 0;

export type Project = {
  id: string;
  name: string;
  domain?: string;
  initials: string;
  isPrimary?: boolean;
  intakeToken?: string;
  /** Instagram-ник без @ — для подписи на креативах (webhook username). */
  creativeUsername?: string;
};

function makeInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "");
  return letters.toUpperCase() || "PR";
}

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  domain: r.domain ?? undefined,
  initials: r.initials,
  isPrimary: r.is_primary,
  intakeToken: r.intake_token ?? undefined,
  creativeUsername: r.creative_username ?? undefined,
});

function describeProjectDbError(error: PostgrestError | null, needsAuth: boolean): string {
  if (needsAuth) return "Войдите в аккаунт, чтобы создать проект";
  if (!error) return "Не удалось создать проект";
  const msg = error.message ?? "";
  const code = error.code ?? "";
  if (code === "PGRST205" || /Could not find the table/i.test(msg)) {
    return "Таблица projects не найдена в Supabase — примените миграции на mekwfbqmsqiborjdrjxc.";
  }
  if (
    code === "42501" ||
    /row-level security/i.test(msg) ||
    /permission denied/i.test(msg)
  ) {
    return "Нет прав на проект. Войдите заново.";
  }
  if (/intake_token/i.test(msg)) {
    return "Обновите приложение из GitHub (исправление select projects).";
  }
  return msg || "Не удалось создать проект";
}

function setActiveProjectEverywhere(id: string, optimistic = false) {
  activeProjectIdSnapshot = id;
  if (optimistic) {
    optimisticActiveProjectId = id;
    optimisticActiveProjectUntil = Date.now() + 3_000;
  }
  activeProjectSubscribers.forEach((cb) => cb(id));
  window.dispatchEvent(new CustomEvent(ACTIVE_PROJECT_CHANGED_EVENT, { detail: { id } }));
}

export function useProjectsStore() {
  const { user, session } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string>(activeProjectIdSnapshot);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creativeUsernameAvailable, setCreativeUsernameAvailable] = useState(true);

  const refetch = useCallback(async () => {
    const { rows, creativeUsernameAvailable: hasColumn, error } = await fetchProjectsRows();
    if (error) {
      const msg = describeProjectDbError(error, false);
      setLoadError(msg);
      console.warn("[projects] refetch:", error.code, error.message);
      return;
    }
    setLoadError(null);
    setCreativeUsernameAvailable(hasColumn);
    const list = rows.map((r) => toProject(r));
    setProjects(list);

    if (user?.id) {
      const { data: ap } = await supabase
        .from("user_active_project")
        .select("project_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (ap?.project_id && list.find((p) => p.id === ap.project_id)) {
        const nextId = optimisticActiveProjectId && Date.now() < optimisticActiveProjectUntil
          ? optimisticActiveProjectId
          : ap.project_id;
        setActiveProjectEverywhere(nextId);
      } else if (list[0]) {
        const nextId = optimisticActiveProjectId && Date.now() < optimisticActiveProjectUntil
          ? optimisticActiveProjectId
          : list[0].id;
        setActiveProjectEverywhere(nextId);
      }
    } else if (list[0]) {
      setActiveProjectEverywhere(list[0].id);
    }
  }, [user?.id]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    activeProjectSubscribers.add(setActiveId);
    const onActiveProjectChanged = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id) setActiveId(id);
    };
    window.addEventListener(ACTIVE_PROJECT_CHANGED_EVENT, onActiveProjectChanged);
    return () => {
      activeProjectSubscribers.delete(setActiveId);
      window.removeEventListener(ACTIVE_PROJECT_CHANGED_EVENT, onActiveProjectChanged);
    };
  }, []);

  useRealtimeTable("projects", refetch);
  useRealtimeTable("user_active_project", refetch, !!user?.id);

  const addProject = useCallback(
    async (name: string, domain?: string) => {
      const uid = session?.user?.id ?? user?.id;
      if (!uid) {
        throw new Error(describeProjectDbError(null, true));
      }

      const payload = {
        name: name.trim(),
        domain: domain?.trim() || null,
        initials: makeInitials(name),
        created_by: uid,
      };
      let insertResult = await supabase
        .from("projects")
        .insert(payload)
        .select(PROJECTS_LIST_COLUMNS)
        .single();

      if (
        insertResult.error &&
        isMissingCreativeUsernameColumn(insertResult.error.message ?? "")
      ) {
        insertResult = await supabase
          .from("projects")
          .insert(payload)
          .select(PROJECTS_BASE_COLUMNS)
          .single();
      }

      const { data, error } = insertResult;
      if (error || !data) {
        throw new Error(describeProjectDbError(error, false));
      }

      const project = toProject(data as ProjectRow);

      await supabase.from("project_members").upsert(
        { project_id: project.id, user_id: uid, role: "owner" },
        { onConflict: "project_id,user_id" },
      );

      await supabase
        .from("user_active_project")
        .upsert({ user_id: uid, project_id: project.id });

      setActiveProjectEverywhere(project.id, true);
      await refetch();
      return project;
    },
    [user?.id, session?.user?.id, refetch],
  );

  const removeProject = useCallback(
    async (id: string) => {
      await supabase.from("projects").delete().eq("id", id);
      await refetch();
    },
    [refetch],
  );

  const setActive = useCallback(
    async (id: string) => {
      setActiveProjectEverywhere(id, true);
      if (!user?.id) return;
      await supabase.from("user_active_project").upsert({ user_id: user.id, project_id: id });
      optimisticActiveProjectId = null;
      optimisticActiveProjectUntil = 0;
    },
    [user?.id],
  );

  const rotateIntakeToken = useCallback(
    async (projectId: string) => {
      const { data, error } = await supabase.rpc("rotate_project_intake_token", {
        p_project_id: projectId,
      });
      if (error) throw error;
      await refetch();
      return data as unknown as string;
    },
    [refetch],
  );

  const updateCreativeUsername = useCallback(
    async (projectId: string, raw: string) => {
      const { data, error } = await supabase.rpc("set_project_creative_username", {
        p_project_id: projectId,
        p_username: raw.trim() || null,
      });
      if (error) {
        if (/creative_username|column/i.test(error.message)) {
          throw new Error(
            "Колонка creative_username ещё не в БД — примените миграцию 20260609190000_projects_creative_username.sql",
          );
        }
        throw new Error(error.message || "Не удалось сохранить ник");
      }
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, creativeUsername: (data as string | null) ?? undefined }
            : p,
        ),
      );
      await refetch();
      return (data as string | null) ?? "";
    },
    [refetch],
  );

  const active = projects.find((p) => p.id === activeId) ?? projects[0];

  return {
    projects,
    active,
    activeId,
    loadError,
    creativeUsernameAvailable,
    addProject,
    removeProject,
    setActive,
    rotateIntakeToken,
    updateCreativeUsername,
  };
}
