import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchCampaignDetail } from "@/lib/broadcastServer";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { BROADCASTS_QUERY_KEY } from "@/hooks/useBroadcasts";

export const BROADCAST_DETAIL_KEY = "broadcast-detail";

export function useBroadcastDetail(campaignId: string | undefined, projectId: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [BROADCAST_DETAIL_KEY, projectId, campaignId],
    queryFn: () => fetchCampaignDetail(campaignId!, projectId!),
    enabled: !!campaignId && !!projectId,
    // Отчёт: цифры доставки / группы / CRM без ручного обновления.
    refetchInterval: 12_000,
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [BROADCAST_DETAIL_KEY, projectId, campaignId] });
    void queryClient.invalidateQueries({ queryKey: [BROADCASTS_QUERY_KEY, projectId] });
  }, [queryClient, projectId, campaignId]);

  useRealtimeTable("broadcast_recipients", invalidate, !!campaignId && !!projectId, 600);
  useRealtimeTable("broadcast_campaigns", invalidate, !!campaignId && !!projectId, 800);
  // CRM-стадии/оплаты тоже двигают воронку (вебинар → оплата).
  useRealtimeTable("leads", invalidate, !!campaignId && !!projectId, 1200);

  return {
    detail: query.data ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: invalidate,
  };
}
