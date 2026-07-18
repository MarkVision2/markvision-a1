# Правила и запросы б-роллов (Видео с озвучкой + Монтаж съёмки)

Жёсткие правила: когда вставлять живой б-ролл, а когда графику, и какие
поисковые запросы (Pexels/ИИ) использовать по смыслу фразы. Цель — плотный,
брендовый кадр, без «пустоты» и без случайного стока.

## Когда что вставлять
- **Живой б-ролл (image/clip)** — на образные/сюжетные фразы: действие, объект,
  место, процесс, эмоция («завален рутиной», «нейросеть создаёт контент»,
  «отчёты уходят клиентам», «6 лет в маркетинге»).
- **Моушн-карточка** (23 шаблона) — на цифры/списки/данные/факты (ТОП-3,
  «200 000 → 1 000 000», чеклист, метрика). Графике — цифры, б-роллу — образы.
- **Кинетический текст / караоке** — на панчлайны, связки и CTA.
- В «Монтаж съёмки» (говорящая голова) б-ролл/вставки идут **оверлеем** (спикер
  виден), полноэкранные — только на панчах. В «Видео с озвучкой» (без лица)
  б-ролл может быть на весь кадр.

## Технические требования к клипу
- Вертикаль 9:16 (`orientation=portrait`), 3–10 сек, без вшитого текста/логотипов,
  без водяных знаков; чистый, «дорогой» кадр (tech/бизнес).
- Каждый подобранный клип проходит **ревью перед публикацией** — любой можно
  заменить одной командой. Своя библиотека (bucket `broll`) — приоритет, если
  загружена.
- Плашки/титры не перекрывают лицо (safe zone).

## Запреты
- **Не фильтровать людей по цвету кожи, этничности или иным защищённым признакам** —
  это дискриминация и нарушение правил стоков. Контроль над картинкой — через
  точные запросы (стиль/сеттинг/настроение), ревью и свою библиотеку, а не через
  отбор по расе.
- Без брендов конкурентов, без узнаваемых лиц/знаменитостей, без чужих логотипов.

## Карта смысл → запрос (Pexels, англ. — так сток ищет точнее)
Запросы намеренно «деловые/технологичные», чтобы попадать в бренд.

| Смысл фразы | Запросы (por trait) |
| --- | --- |
| рутина, вручную, завал, усталость | `busy office worker laptop night`, `stressed desk paperwork`, `typing laptop late` |
| маркетинг, реклама, таргет | `digital marketing dashboard screen`, `social media ads analytics`, `advertising graphs screen` |
| нейросеть, ИИ, автоматизация | `artificial intelligence abstract`, `futuristic data network`, `technology hologram interface`, `server data center` |
| контент, креативы, дизайн | `creative workspace design`, `video editing timeline screen`, `content creation smartphone` |
| отчёты, аналитика, цифры | `business analytics chart screen`, `financial dashboard statistics`, `growth graph animation` |
| деньги, доход, рост | `money growth chart`, `financial success`, `upward arrow graph` |
| сайты, CRM, системы, код | `software interface ui`, `web code screen`, `crm dashboard app` |
| клиенты, сообщения, заявки | `smartphone notification chat`, `customer message app`, `phone typing message` |
| время, каждый день, скорость | `clock time lapse`, `calendar schedule`, `city timelapse sunrise` |
| эксперт, стратегия, уверенность | `confident professional working`, `business strategy meeting`, `entrepreneur focused` |
| хук, внимание, динамика | `cinematic city night`, `dynamic abstract motion background`, `fast motion lights` |
| CTA, срочность, места | `countdown timer`, `hand pointing phone screen`, `limited time` |

## Как подключается
1. Ключ **`PEXELS_API_KEY`** в Supabase → Edge Functions → Secrets.
2. Edge-функция `reels-broll` (action `pexels`): по массиву запросов ищет
   вертикальные клипы, качает и кладёт в bucket `renders/broll/<jobId>/…`,
   отдаёт Supabase-URL (нашу сеть Pexels напрямую не пускает).
3. Claude-сессия при разметке сцен подставляет `image`/`clip` в `reels.json`
   (движок `ReelsExplainer`) или в `inserts.json` (Shorts916) по этой карте.
4. ИИ-генерация (kie.ai / FLUX) — тем же движком, когда сток не даёт нужного
   образа; модель по умолчанию — FLUX (картинка) + image-to-video на хуках.
