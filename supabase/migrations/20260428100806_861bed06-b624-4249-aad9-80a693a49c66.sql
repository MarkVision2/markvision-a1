-- Таблица подписок на отчёты в Telegram (общая на проект, без авторизации)
CREATE TABLE public.report_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Отчёт',
  chat_id TEXT NOT NULL,
  schedule TEXT NOT NULL DEFAULT 'daily', -- daily | weekdays | weekly_mon | monthly
  send_hour INTEGER NOT NULL DEFAULT 9 CHECK (send_hour >= 0 AND send_hour <= 23),
  cabinet_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  period TEXT NOT NULL DEFAULT 'last_7d', -- yesterday | last_7d | last_30d
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.report_subscriptions ENABLE ROW LEVEL SECURITY;

-- Публичный доступ (нет авторизации в проекте — общая на всех)
CREATE POLICY "Anyone can read report subscriptions"
  ON public.report_subscriptions FOR SELECT USING (true);
CREATE POLICY "Anyone can create report subscriptions"
  ON public.report_subscriptions FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update report subscriptions"
  ON public.report_subscriptions FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete report subscriptions"
  ON public.report_subscriptions FOR DELETE USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_report_subscriptions_updated_at
  BEFORE UPDATE ON public.report_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();