import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

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

const PROJECT_SELECT = "id,name,domain,initials,is_primary,created_by,created_at,updated_at";

const toProject = (r: Row): Project => ({
  id: r.id,
  name: r.name,
  domain: r.domain ?? undefined,
  initials: r.initials,
  isPrimary: r.is_primary,
  intakeToken: r.intake_token ?? undefined,
});

export function useProjectsStore() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  const refetch = useCallback(async () => {
    const { data, error } = await supabase
      .from("projects")
      .select(PROJECT_SELECT)
      .order("created_at");
    if (error) {
      console.error("[projects] refetch failed", error);
      setProjects([]);
      return;
    }
    const list = (data ?? []).map((r) => toProject(r as Row));
    const { data: tokenRows } = await supabase
      .from("projects")
      .select("id,intake_token")
      .in("id", list.map((p) => p.id));
    const tokens = new Map(
      (tokenRows ?? []).map((r) => [
        (r as { id: string }).id,
        (r as { intake_token?: string | null }).intake_token ?? undefined,
      ]),
    );
    for (const project of list) {
      project.intakeToken = tokens.get(project.id);
    }
    setProjects(list);

    if (user?.id) {
      const { data: ap } = await supabase
        .from("user_active_project")
        .select("project_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (ap?.project_id && list.find((p) => p.id === ap.project_id)) {
        setActiveId(ap.project_id);
      } else if (list[0]) {
        setActiveId(list[0].id);
      }
    } else if (list[0]) {
      setActiveId(list[0].id);
    }
  }, [user?.id]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useRealtimeTable("projects", refetch);
  useRealtimeTable("user_active_project", refetch, !!user?.id);

  const addProject = useCallback(
    async (name: string, domain?: string) => {
      if (!user?.id) {
        throw new Error("Нужно войти в аккаунт, чтобы создать проект");
      }
      const safeName = name.trim();
      if (!safeName) {
        throw new Error("Введите название проекта");
      }
      const payload = {
        name: safeName,
        domain: domain?.trim() || null,
        initials: makeInitials(safeName),
        created_by: user.id,
      };
      const { data, error } = await supabase
        .from("projects")
        .insert(payload)
        .select(PROJECT_SELECT)
        .single();
      if (error) throw error;
      if (!data) throw new Error("Supabase не вернул созданный проект");
      const project = toProject(data as Row);
      const { error: activeErr } = await supabase
        .from("user_active_project")
        .upsert({ user_id: user.id, project_id: project.id });
      if (activeErr) console.warn("[projects] active project upsert failed", activeErr);
      await refetch();
      setActiveId(project.id);
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
      if (!user?.id) {
        setActiveId(id);
        return;
      }
      await supabase.from("user_active_project").upsert({ user_id: user.id, project_id: id });
      setActiveId(id);
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
