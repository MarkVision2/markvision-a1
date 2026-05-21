import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

const ACTIVE_PROJECT_CHANGED_EVENT = "markvision:active-project-changed";
let optimisticActiveProjectId: string | null = null;
let optimisticActiveProjectUntil = 0;

export type Project = {
  id: string;
  name: string;
  domain?: string;
  initials: string;
  isPrimary?: boolean;
  intakeToken?: string;
};

function makeInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "");
  return letters.toUpperCase() || "PR";
}

type Row = {
  id: string;
  name: string;
  domain: string | null;
  initials: string;
  is_primary: boolean;
  intake_token?: string | null;
};

const toProject = (r: Row): Project => ({
  id: r.id,
  name: r.name,
  domain: r.domain ?? undefined,
  initials: r.initials,
  isPrimary: r.is_primary,
  intakeToken: r.intake_token ?? undefined,
});

function broadcastActiveProject(id: string, optimistic = false) {
  if (optimistic) {
    optimisticActiveProjectId = id;
    optimisticActiveProjectUntil = Date.now() + 3_000;
  }
  window.dispatchEvent(new CustomEvent(ACTIVE_PROJECT_CHANGED_EVENT, { detail: { id } }));
}

export function useProjectsStore() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  const refetch = useCallback(async () => {
    const { data } = await supabase.from("projects").select("*").order("created_at");
    const list = (data ?? []).map((r) => toProject(r as Row));
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
        setActiveId(nextId);
      } else if (list[0]) {
        const nextId = optimisticActiveProjectId && Date.now() < optimisticActiveProjectUntil
          ? optimisticActiveProjectId
          : list[0].id;
        setActiveId(nextId);
      }
    } else if (list[0]) {
      setActiveId(list[0].id);
    }
  }, [user?.id]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    const onActiveProjectChanged = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id) setActiveId(id);
    };
    window.addEventListener(ACTIVE_PROJECT_CHANGED_EVENT, onActiveProjectChanged);
    return () => window.removeEventListener(ACTIVE_PROJECT_CHANGED_EVENT, onActiveProjectChanged);
  }, []);

  useRealtimeTable("projects", refetch);
  useRealtimeTable("user_active_project", refetch, !!user?.id);

  const addProject = useCallback(
    async (name: string, domain?: string) => {
      const payload = {
        name: name.trim(),
        domain: domain?.trim() || null,
        initials: makeInitials(name),
        created_by: user?.id ?? null,
      };
      const { data, error } = await supabase.from("projects").insert(payload).select().single();
      if (error || !data) throw error;
      const project = toProject(data as Row);
      if (user?.id) {
        await supabase
          .from("user_active_project")
          .upsert({ user_id: user.id, project_id: project.id });
      }
      await refetch();
      return project;
    },
    [user?.id, refetch],
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
      setActiveId(id);
      broadcastActiveProject(id, true);
      if (!user?.id) {
        return;
      }
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

  const active = projects.find((p) => p.id === activeId) ?? projects[0];

  return { projects, active, activeId, addProject, removeProject, setActive, rotateIntakeToken };
}
