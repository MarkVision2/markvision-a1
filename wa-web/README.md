# WhatsApp Web → CRM (бесплатно)

Подключение WhatsApp к MarkVision CRM через QR (как WhatsApp Web), **без Green API**.
Green API по-прежнему для автоматизаций и рассылок.

## Что нужно

1. Секрет Supabase `WA_WEB_WORKER_KEY` (длинная случайная строка).
2. VPS / любой постоянно включённый Node 20+ (тот же, где montage-daemon).
3. В `.env` корня репозитория:

```bash
VITE_SUPABASE_URL=https://szfgdruhlebfvcmlvxdk.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=...
WA_WEB_WORKER_KEY=...   # тот же, что в Supabase secrets
```

## Запуск

```bash
cd wa-web && npm install
node daemon.mjs
# или pm2:
pm2 start daemon.mjs --name wa-web --cwd /path/to/repo/wa-web
```

## В интерфейсе

Настройки → Подключение WhatsApp → блок **«WhatsApp Web (бесплатно)»** →
«Показать QR» → сканируете телефоном (Связанные устройства).

Входящие и исходящие с телефона попадают в CRM → Чаты.
