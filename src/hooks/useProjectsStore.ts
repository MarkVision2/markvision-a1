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
};

const toProject = (r: Row): Project => ({
  id: r.id,
  name: r.name,
  domain: r.domain ?? undefined,
  initials: r.initials,
  isPrimary: r.is_primary,
});

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
      if (!user?.id) {
        setActiveId(id);
        return;
      }
      await supabase.from("user_active_project").upsert({ user_id: user.id, project_id: id });
      setActiveId(id);
    },
    [user?.id],
  );

  const active = projects.find((p) => p.id === activeId) ?? projects[0];

  return { projects, active, activeId, addProject, removeProject, setActive };
}
