# n8n self-hosted (v2.0+) — конфиги для VPS

Эти файлы — то, что должно лежать на сервере, где крутится `n8n.zapoinov.com`.
Сюда сложены исправления, чтобы после апгрейда на n8n v2.0 снова работали
**Execute Command node** и **Read/Write File node**.

## Что внутри

- `docker-compose.yml` — патченный compose (env-переменные + volumes + whitelist).
- `Dockerfile` — кастомный образ `n8n-with-ffmpeg:latest` (base + ffmpeg).
- `.env` — на сервере, не в репо. Должен содержать `SUBDOMAIN`, `DOMAIN_NAME`,
  `SSL_EMAIL`, `GENERIC_TIMEZONE`.

## Что чинит compose (по сравнению со старым v1.9)

| Переменная                       | Зачем                                                    |
| -------------------------------- | -------------------------------------------------------- |
| `N8N_ALLOW_EXECUTE_COMMAND=true` | Включает Execute Command node (в v2.0 выкл. по умолчанию) |
| `N8N_ENABLE_NODE_DEV=true`       | Разрешает кастомные / dev-ноды                            |
| `NODES_EXCLUDE=`                 | Пусто = ничего не исключать (`[]` из исходной инструкции — невалидно, n8n ждёт CSV-строку) |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` | Разрешает читать env-переменные из нод                |
| `N8N_FILESYSTEM_PATH_WHITELIST`  | Белый список путей для FS-нод                            |
| `N8N_RESTRICT_FILE_ACCESS_TO`    | То же, новое имя в v2.0                                  |

Volumes:
- `./videos:/home/node/.n8n-files` — в этот путь пишет Write File node
- `./videos:/videos` — алиас того же каталога, чтобы whitelist `/videos` ловил
- `/usr/share/fonts:/usr/share/fonts` — шрифты для ffmpeg/рендеринга

## Деплой на сервер

```bash
# 1. Залить файлы (с локальной машины)
scp docker-compose.yml Dockerfile user@server:/path/to/n8n/

# 2. На сервере: собрать образ с ffmpeg
cd /path/to/n8n
docker build -t n8n-with-ffmpeg:latest .

# 3. Подготовить каталог ./videos с правильными правами
#    (n8n в контейнере запускается под UID 1000)
mkdir -p ./videos
sudo chown -R 1000:1000 ./videos
sudo chmod -R 755 ./videos
# chmod 777 из исходной инструкции НЕ нужен — после chown 1000:1000
# прав 755 хватает. 777 — это «писать может кто угодно», лишний риск.

# 4. Перезапустить стек
docker compose down
docker compose up -d

# 5. Проверить логи
docker compose logs -f n8n
```

## Куда писать файлы из ноды Write File

```
/home/node/.n8n-files/имя_файла.mp4
```

На хосте это окажется в `./videos/имя_файла.mp4` (тот же каталог).

## Откат

Если что-то пошло не так — старый `docker-compose.yml` (v1.9) лежал
без `N8N_ALLOW_EXECUTE_COMMAND` и без whitelist. Восстановить:

```bash
git checkout HEAD~1 -- docker-compose.yml
docker compose up -d
```
