
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_pipeline_id_fkey;
ALTER TABLE public.leads ADD CONSTRAINT leads_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE SET NULL;

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_stage_id_fkey;
ALTER TABLE public.leads ADD CONSTRAINT leads_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;
