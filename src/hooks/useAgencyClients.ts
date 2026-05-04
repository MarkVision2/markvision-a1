import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

export type AgencyService = {
  id: string;
  name: string;
  price: number;
  cost: number;
};

export type AgencyClientStatus = "waiting" | "paid" | "overdue" | "cancelled";

export type AgencyClient = {
  id: string;
  name: string;
  services: AgencyService[];
  payDate?: string;
  status: AgencyClientStatus;
  createdAt: string;
};

export const SERVICE_CATALOG: { id: string; name: string; price: number; cost: number }[] = [
  { id: "target", name: "Таргет", price: 250_000, cost: 50_000 },
  { id: "smm", name: "SMM", price: 200_000, cost: 60_000 },
  { id: "marketing", name: "Маркетинг", price: 350_000, cost: 80_000 },
  { id: "content", name: "Контент", price: 180_000, cost: 40_000 },
  { id: "seo", name: "SEO", price: 220_000, cost: 50_000 },
  { id: "dev", name: "Разработка", price: 500_000, cost: 200_000 },
  { id: "design", name: "Дизайн", price: 150_000, cost: 40_000 },
  { id: "crm", name: "CRM", price: 200_000, cost: 50_000 },
];

export function useAgencyClients() {
  const { user } = useAuth();
  const [clients, setClients] = useState<AgencyClient[]>([]);

  const refetch = useCallback(async () => {
    const { data: rows } = await supabase
      .from("agency_clients")
      .select("*, agency_client_services(*)")
      .order("created_at", { ascending: false });
    const list: AgencyClient[] = (rows ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      payDate: r.pay_date ?? undefined,
      status: r.status as AgencyClientStatus,
      createdAt: r.created_at,
      services: (r.agency_client_services ?? []).map((s: any) => ({
        id: s.id,
        name: s.name,
        price: Number(s.price ?? 0),
        cost: Number(s.cost ?? 0),
      })),
    }));
    setClients(list);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);
  useRealtimeTable("agency_clients", refetch);
  useRealtimeTable("agency_client_services", refetch);

  const addClient = useCallback(async (c: Omit<AgencyClient, "id" | "createdAt">) => {
    const { data, error } = await supabase
      .from("agency_clients")
      .insert({
        name: c.name,
        pay_date: c.payDate ?? null,
        status: c.status,
        created_by: user?.id ?? null,
      })
      .select()
      .single();
    if (error || !data) throw error;
    if (c.services.length) {
      await supabase.from("agency_client_services").insert(
        c.services.map((s) => ({
          client_id: data.id,
          name: s.name,
          price: s.price,
          cost: s.cost,
        })),
      );
    }
    await refetch();
  }, [user?.id, refetch]);

  const updateClient = useCallback(async (id: string, patch: Partial<AgencyClient>) => {
    const dbPatch: { name?: string; pay_date?: string | null; status?: string } = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.payDate !== undefined) dbPatch.pay_date = patch.payDate || null;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (Object.keys(dbPatch).length) {
      await supabase.from("agency_clients").update(dbPatch).eq("id", id);
    }
    if (patch.services) {
      await supabase.from("agency_client_services").delete().eq("client_id", id);
      if (patch.services.length) {
        await supabase.from("agency_client_services").insert(
          patch.services.map((s) => ({
            client_id: id,
            name: s.name,
            price: s.price,
            cost: s.cost,
          })),
        );
      }
    }
    await refetch();
  }, [refetch]);

  const removeClient = useCallback(async (id: string) => {
    await supabase.from("agency_clients").delete().eq("id", id);
    await refetch();
  }, [refetch]);

  return { clients, addClient, updateClient, removeClient };
}
