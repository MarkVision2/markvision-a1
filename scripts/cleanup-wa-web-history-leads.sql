-- Cleanup: WhatsApp Web history flood → fake CRM leads after QR pair.
-- Project Юрий Мед (0908cd86-0721-4031-be82-02a6a8a4f99c), incident 2026-08-04.
-- Communications cascade via leads FK. Idempotent.

DELETE FROM public.leads
WHERE project_id = '0908cd86-0721-4031-be82-02a6a8a4f99c'
  AND channel = 'whatsapp'
  AND source = 'whatsapp'
  AND created_at >= '2026-08-04 15:05:00+00'
  AND created_at < '2026-08-04 16:00:00+00';
