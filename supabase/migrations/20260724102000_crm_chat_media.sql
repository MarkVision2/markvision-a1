-- Media attachments for CRM chat (WhatsApp voice/images/video/files).

ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS media_kind text,
  ADD COLUMN IF NOT EXISTS media_mime text,
  ADD COLUMN IF NOT EXISTS media_filename text;

COMMENT ON COLUMN public.communications.media_url IS 'Public URL in crm-chat-media bucket';
COMMENT ON COLUMN public.communications.media_kind IS 'image|audio|video|document|sticker';

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('crm-chat-media', 'crm-chat-media', true, 52428800)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "crm_chat_media_public_read" ON storage.objects;
CREATE POLICY "crm_chat_media_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'crm-chat-media');

DROP POLICY IF EXISTS "crm_chat_media_service_write" ON storage.objects;
-- Authenticated uploads not needed; edge uses service role (bypasses RLS).
-- Keep an explicit insert policy for service-role-compatible clients if any.
CREATE POLICY "crm_chat_media_auth_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'crm-chat-media');
