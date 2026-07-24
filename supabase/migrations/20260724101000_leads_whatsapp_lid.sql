-- WhatsApp Web may address contacts by opaque LID (@lid), not phone.
-- Store LID separately; never treat LID digits as dialable phone.

ALTER TABLE public.leads
  ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS whatsapp_lid text;

CREATE INDEX IF NOT EXISTS leads_project_whatsapp_lid_idx
  ON public.leads (project_id, whatsapp_lid)
  WHERE whatsapp_lid IS NOT NULL;

COMMENT ON COLUMN public.leads.whatsapp_lid IS
  'WhatsApp linked id (digits only, without @lid). Used when PN is not yet known.';

-- Repair leads created from LID mistaken for phone (e.g. +80968874504413).
UPDATE public.leads
SET
  whatsapp_lid = COALESCE(
    whatsapp_lid,
    regexp_replace(phone, '\D', '', 'g')
  ),
  phone = NULL
WHERE
  phone IS NOT NULL
  AND (
    length(regexp_replace(phone, '\D', '', 'g')) >= 13
    OR regexp_replace(phone, '\D', '', 'g') LIKE '80%'
  )
  AND (
    channel::text ILIKE '%whatsapp%'
    OR COALESCE(source, '') ILIKE '%whatsapp%'
  );
