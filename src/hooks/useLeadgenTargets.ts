import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type LgCity = {
  id: string;
  city: string;
  enabled: boolean;
  sort: number;
  last_parsed_at: string | null;
};
export type LgRubric = {
  id: string;
  rubric: string;
  label: string;
  enabled: boolean;
  sort: number;
};

/**
 * Города-очередь и направления (рубрики) для парсера лидгена.
 * Города парсятся по кругу — наименее давно парсенный первым.
 */
export function useLeadgenTargets(projectId: string | null) {
  const [cities, setCities] = useState<LgCity[]>([]);
  const [rubrics, setRubrics] = useState<LgRubric[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!projectId) {
      setCities([]); setRubrics([]); setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: c }, { data: r }] = await Promise.all([
      supabase.from("lg_cities").select("id, city, enabled, sort, last_parsed_at")
        .eq("project_id", projectId).order("last_parsed_at", { ascending: true, nullsFirst: true }).order("sort"),
      supabase.from("lg_rubrics").select("id, rubric, label, enabled, sort")
        .eq("project_id", projectId).order("sort"),
    ]);
    setCities((c ?? []) as LgCity[]);
    setRubrics((r ?? []) as LgRubric[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void refetch(); }, [refetch]);

  const toggleCity = useCallback(async (id: string, enabled: boolean) => {
    await supabase.from("lg_cities").update({ enabled }).eq("id", id);
    setCities((prev) => prev.map((c) => (c.id === id ? { ...c, enabled } : c)));
  }, []);

  const toggleRubric = useCallback(async (id: string, enabled: boolean) => {
    await supabase.from("lg_rubrics").update({ enabled }).eq("id", id);
    setRubrics((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
  }, []);

  const addCity = useCallback(async (city: string) => {
    const name = city.trim();
    if (!name || !projectId) return;
    const { error } = await supabase.from("lg_cities").insert({ project_id: projectId, city: name, sort: 500 });
    if (error) throw new Error(error.message);
    await refetch();
  }, [projectId, refetch]);

  const addRubric = useCallback(async (rubric: string, label: string) => {
    const q = rubric.trim(); const l = (label.trim() || rubric.trim());
    if (!q || !projectId) return;
    const { error } = await supabase.from("lg_rubrics").insert({ project_id: projectId, rubric: q, label: l, sort: 500 });
    if (error) throw new Error(error.message);
    await refetch();
  }, [projectId, refetch]);

  const removeCity = useCallback(async (id: string) => {
    await supabase.from("lg_cities").delete().eq("id", id);
    setCities((prev) => prev.filter((c) => c.id !== id));
  }, []);
  const removeRubric = useCallback(async (id: string) => {
    await supabase.from("lg_rubrics").delete().eq("id", id);
    setRubrics((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { cities, rubrics, loading, refetch, toggleCity, toggleRubric, addCity, addRubric, removeCity, removeRubric };
}
