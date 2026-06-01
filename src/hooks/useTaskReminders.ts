import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { useProjectsStore } from "@/hooks/useProjectsStore";

export interface TaskReminderItem {
  taskId: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  title: string;
  dueAt: string;
}

type TaskRow = {
  id: string;
  lead_id: string;
  title: string;
  due_at: string;
  leads: { name: string; phone: string; project_id: string | null } | null;
};

/** Lightweight pending tasks for global reminder toast — no full CRM store. */
export function useTaskReminders() {
  const { activeId: projectId } = useProjectsStore();
  const [items, setItems] = useState<TaskReminderItem[]>([]);

  const refetch = useCallback(async () => {
    if (!projectId) {
      setItems([]);
      return;
    }
    const { data, error } = await supabase
      .from("tasks")
      .select("id, lead_id, title, due_at, leads!inner(name, phone, project_id)")
      .is("done_at", null)
      .eq("leads.project_id", projectId)
      .order("due_at", { ascending: true })
      .limit(200);
    if (error) {
      console.warn("[useTaskReminders] fetch failed", error.message);
      return;
    }
    const list: TaskReminderItem[] = [];
    for (const row of (data ?? []) as TaskRow[]) {
      const lead = row.leads;
      if (!lead) continue;
      list.push({
        taskId: row.id,
        leadId: row.lead_id,
        leadName: lead.name ?? "",
        leadPhone: lead.phone ?? "",
        title: row.title,
        dueAt: row.due_at,
      });
    }
    setItems(list);
  }, [projectId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useRealtimeTable("tasks", refetch, true, 800);
  useRealtimeTable("leads", refetch, true, 1200);

  const toggleTask = useCallback(async (leadId: string, taskId: string) => {
    const nowIso = new Date().toISOString();
    await supabase
      .from("tasks")
      .update({ status: "done", done_at: nowIso })
      .eq("id", taskId)
      .eq("lead_id", leadId);
    setItems((prev) => prev.filter((t) => t.taskId !== taskId));
  }, []);

  return { items, toggleTask, refetch };
}
