// Промпты Контент-завода, перенесённые из n8n-воркфлоу «Clony AI» дословно.
//
// Это ценная часть: формулировки подбирались на живых генерациях, и любая
// вольная переработка меняет результат. Менялись только подстановки — выражения
// n8n ($item("0").$node[...]) заменены на токены {{name}}, которые подставляет
// renderPrompt из contentFactoryGen.ts. Сам текст не тронут.
//
// Источник — рабочий клон воркфлоу «Даяна Сontent ЗАВОД» (n8n 6pnv6NrDkbwyCflT):
// ветки Switch1 по body.content_type. Оригинал (dCQ20aXv6B9LRjDe) недоступен
// нашему токену, но ветки в клоне те же.
//
// Токены: {{all_data}} {{prompt}} {{name}} {{description}} {{content_type}}
// {{style}} {{color}} {{language}} {{aspect}} {{platform}} {{slides}} {{ctas}}
// {{fb_niche}} {{chat_id}} {{image_analysis}} {{text_analysis}} {{site_data}}

/** Ветка content_type = 'fb-target' (нода n8n «facebook ads»). */
export const FB_TARGET_PROMPT = `make the best facebook ads creatives ab\\testing in the most high level!

all input data: {{all_data}}

3. ТЗ ОТ КЛИЕНТА: {{text_analysis}}

ниша; {{fb_niche}}



all slides must be in langeuge {{language}}

always always include what langeuge and what text if there text in the image prompt in every slide in json

make ads this size:
{{aspect}}

only in this size! for all slides

zeroing in the product card's layout.
in the final prompt for evry slide it must be really specified (if user asked) every ask of user must be good specified in the final json prompts 

even if not specified and you get image

4. АНАЛИЗ ФОТО: {{image_analysis}}

use all images and refernces pay attention to it 

используй фишки фишки чтобы зацеить внимание
боли 
мифы
хуки
отрицательные 
как не делать это потому 
некогда не чтото потому что вот так 


стиль: {{style}}

цвет: {{color}}

призывы - {{ctas}}

never change the product color ( the color means the desing main ackent color pallete)


язык: {{language}}

if no username was specified - dont add the username

content_type: {{content_type}}

data:

{{site_data}}

if you get reference images delete all no needed icons text and names that are not relevant for current user task of creative generate

how much slides to generate: {{slides}}


make it in the languege asked in the input (even if the product is other languege)

make it really extended cool proffesional design! with all good texts


always include the main product name in headline 

make sure the all slides contains the product image in some way or a part of it could be in diffent style even like in 3d or other ways but dont make an slides like with only texts

если не указали язык делай на руссокм

always return json with full "image_prompt": { for all slides in the araay json

делай уникальный дизайн исходя из своиз сооброжениии и входных данных
(не придерживайся только примерами что в инстуркии эти примеры это только варианты )

try to make prompt to generate the best slides based all getted input data and the product

make sure to make the number of slides the user asked `;

/** Ветка content_type = 'insta-carousel' (нода n8n «slides instagram carousel»). */
export const INSTA_CAROUSEL_PROMPT = `создай уникальную карусель для инстаграм 

nveer make english if not asked even if half prompt is eglish and the langegue is kz or ru make in russian or kazkah
always always include what langeuge and what text if there text in the image prompt in every slide in json


3. ТЗ ОТ КЛИЕНТА: {{text_analysis}}

all input data: {{all_data}}

all slides must be in langeuge {{language}}

if asked make only one image - from a photo input that contains more than one product in the photo so if user specified what excat product he want to generate slide so make this product - slides

делай карусели с текстом с стортелом 
призывами
с красивыми текстами
так что ты ведешь логический человека по пути как воронка от боли к призыву и действию через решение проблемы - закрытие возрожение - как бы прогреваешь человека и ведешь его к цели.

zeroing in the product card's layout.
in the final prompt for evry slide it must be really specified (if user asked) every ask of user must be good specified in the final json prompts 

even if not specified and you get image

4. АНАЛИЗ ФОТО: {{image_analysis}}

even if not specified and you get image analyse that is few products there so make in the slides prompts ask to make each product in the image seperated in beiuifiul angles proffesional photo to then upload to markteplaces websites

try to make all slides a bit differnt - differnt layouts diffents angles side macro mickro and so on - so the user will have a variotions 

стиль: {{style}}

цвет: {{color}}

призывы - {{ctas}}

never change the product color ( the color means the desing main ackent color pallete)


язык: {{language}}

if no username was specified - dont add the username


phone: {{chat_id}}

если не указан язык или если анализ фото на другом языке например немецйи то базово всегда весь промпт и инструкция какой олжен быть дизайн на каком язвке это русский!


content_type: {{content_type}}

data:

{{site_data}}



how much slides to generate: {{slides}}

if asked 1 make only 1 slide 
if asked 5 do 5
if asked 7 do 7
if asked 10 make 10

if asked 1 slide - make a hero image with infographics in russian

IF NOT SPECIFIED MAKE 1

make it in the languege asked in the input (even if the product is other languege)

make it really extended cool proffesional design! with all good texts


always include the main product name in headline 

make sure the all slides contains the product image in some way or a part of it could be in diffent style even like in 3d or other ways but dont make an slides like with only texts

если не указали язык делай на руссокм

always return json with full "image_prompt": { for all slides in the araay json

делай уникальный дизайн исходя из своиз сооброжениии и входных данных
(не придерживайся только примерами что в инстуркии эти примеры это только варианты )

try to make prompt to generate the best slides based all getted input data and the product

make sure to make the number of slides the user asked `;

/** Ветка content_type = 'instagram-stories' (нода n8n «stories»). */
export const INSTAGRAM_STORIES_PROMPT = `make the best stories и прогревы  

3. ТЗ ОТ КЛИЕНТА: {{text_analysis}}

ниша; {{fb_niche}}


all input data: {{all_data}}

all slides must be in langeuge {{language}}

nveer make english if not asked even if half prompt is eglish and the langegue is kz or ru make in russian or kazkah

always always include what langeuge and what text if there text in the image prompt in every slide in json



if asked make only one image - from a photo input that contains more than one product in the photo so if user specified what excat product he want to generate slide so make this product - slides

zeroing in the product card's layout.
in the final prompt for evry slide it must be really specified (if user asked) every ask of user must be good specified in the final json prompts 

even if not specified and you get image

4. АНАЛИЗ ФОТО: {{image_analysis}}

even if not specified and you get image analyse that is few products there so make in the slides prompts ask to make each product in the image seperated in beiuifiul angles proffesional photo to then upload to markteplaces websites

try to make all slides a bit differnt - differnt layouts diffents angles side macro mickro and so on - so the user will have a variotions 

стиль: {{style}}

цвет: {{color}}

призывы - {{ctas}}

never change the product color ( the color means the desing main ackent color pallete)


язык: {{language}}

kz = казахский!

if no username was specified - dont add the username


CRITICAL RULES FOR IMAGE PROMPTS:
- NEVER use real person names (no "names" you can say add the text and there put the name of who needed)
- Instead use: "professional man", "business person", "the subject"
- NEVER say "me" or "my photo" - say "the person in the reference image"
- For username placeholders use "@username" not real handles
- Describe the STYLE and COMPOSITION, not identity of people


если не указан язык или если анализ фото на другом языке например немецйи то базово всегда весь промпт и инструкция какой олжен быть дизайн на каком язвке это русский!


content_type: {{content_type}}

data:

{{site_data}}



how much slides to generate: {{slides}}

if asked 1 make only 1 slide 
if asked 5 do 5
if asked 7 do 7
if asked 10 make 10

if asked 1 slide - make a hero image with infographics in russian

IF NOT SPECIFIED MAKE 1

make it in the languege asked in the input (even if the product is other languege)

make it really extended cool proffesional design! with all good texts


always include the main product name in headline 

make sure the all slides contains the product image in some way or a part of it could be in diffent style even like in 3d or other ways but dont make an slides like with only texts

если не указали язык делай на руссокм

always return json with full "image_prompt": { for all slides in the araay json

делай уникальный дизайн исходя из своиз сооброжениии и входных данных
(не придерживайся только примерами что в инстуркии эти примеры это только варианты )

try to make prompt to generate the best slides based all getted input data and the product

make sure to make the number of slides the user asked 

make sure the langeuge is язык: {{language}}`;

/** Ветка content_type = 'neuro-photo' (нода n8n «ai photo»). */
export const NEURO_PHOTO_PROMPT = `make the best neurophoto realisitic

3. ТЗ ОТ КЛИЕНТА: {{text_analysis}}

all input data: {{all_data}}

если не просили то можно текст не добовлять и делать только фото

always always include what langeuge and what text if there text in the image prompt in every slide in json


4. АНАЛИЗ ФОТО: {{image_analysis}}


CRITICAL RULES FOR IMAGE PROMPTS:
- NEVER use real person names (no "names" you can say add the text and there put the name of who needed)
- Instead use: "professional man", "business person", "the subject"
- NEVER say "me" or "my photo" - say "the person in the reference image"
- For username placeholders use "@username" not real handles
- Describe the STYLE and COMPOSITION, not identity of people

content_type: {{content_type}}

data:

{{site_data}}


how much slides to generate: {{slides}}


try to make prompt to generate the best slides based all getted input data and the product

make sure to make the number of slides the user asked 

ДЕЛАЙ ТОЛЬКО ФОТО БЕЗ ТЕКСТА
СТАРЙСЯ ДЕЛАТЬ ПРОМТЫ КРАСИВО И ОЧЕНЬ РЕАЛИСТИЧНО И ПОХОЖЕ НА ИСХОДНИК ЛИЦА И ТЕЛА`;

/** Ветка content_type = 'default' (нода n8n «slides»). */
export const DEFAULT_PROMPT = `make the best eccomerca product card design

1. ТОВАР: {{name}}
2. ОПИСАНИЕ:{{description}}

all input data: {{all_data}}

всегда делай все слайды 3:4 если не указан другой размер если указан делай все салйды этого размера

{{aspect}}

all slides must be in langeuge {{language}}


nveer make english if not asked even if half prompt is eglish and the langegue is kz or ru make in russian or kazkah

always always include what langeuge and what text if there text in the image prompt in every slide in json

3. ТЗ ОТ КЛИЕНТА: {{text_analysis}}

if asked make only one image - from a photo input that contains more than one product in the photo so if user specified what excat product he want to generate slide so make this product - slides

zeroing in the product card's layout.
in the final prompt for evry slide it must be really specified (if user asked) every ask of user must be good specified in the final json prompts 

even if not specified and you get image

4. АНАЛИЗ ФОТО: {{image_analysis}}

even if not specified and you get image analyse that is few products there so make in the slides prompts ask to make each product in the image seperated in beiuifiul angles proffesional photo to then upload to markteplaces websites

try to make all slides a bit differnt - differnt layouts diffents angles side macro mickro and so on - so the user will have a variotions 

стиль: {{style}}

цвет: {{color}}

never change the product color ( the color means the desing main ackent color pallete)


язык: {{language}}

если не указан язык или если анализ фото на другом языке например немецйи то базово всегда весь промпт и инструкция какой олжен быть дизайн на каком язвке это русский!

platform: {{platform}}

content_type: {{content_type}}

data:

{{site_data}}



how much slides to generate: {{slides}}

if asked 1 make only 1 slide 
if asked 5 do 5
if asked 7 do 7
if asked 10 make 10

if asked 1 slide - make a hero image with infographics in russian

IF NOT SPECIFIED MAKE 1

make it in the languege asked in the input (even if the product is other languege)

make it really extended cool proffesional design! with all good texts


always include the main product name in headline 

make sure the all slides contains the product image in some way or a part of it could be in diffent style even like in 3d or other ways but dont make an slides like with only texts

если не указали язык делай на руссокм

always return json with full "image_prompt": { for all slides in the araay json

делай уникальный дизайн исходя из своиз сооброжениии и входных данных
(не придерживайся только примерами что в инстуркии эти примеры это только варианты )

try to make prompt to generate the best slides based all getted input data and the product

make sure to make the number of slides the user asked 

делай идеальную карточку товара особено важно первый слайд чтобы был с крутой инфорграфикой красивой яркой стильной крутой и чтобы там было точно описано имя товара как главный заголовок а не какой то маркетинговый текст - сделай максиуму усильиный супер подробный промпты и сделай если болье чем 3 варинатов сдайжов выбрали чтобы хзотя бы первый 3 были хиро карточки в разгных крутых стилях чтобы можно было выбрать хиро карточка самая важная и весь фокус на ней!`;

/** Анализ референсного фото перед генерацией (нода n8n «Analyze image1»). */
export const VISION_ANALYSIS_PROMPT = `# СИСТЕМНЫЙ ПРОМПТ: AI-АНАЛИТИК ВИЗУАЛЬНОГО КОНТЕНТА (VISION)

## РОЛЬ
Ты — профессиональный арт-директор и эксперт по компьютерному зрению (Computer Vision). Твоя специализация — технический анализ исходных фотографий товаров для e-commerce. Ты должен описать изображение так, чтобы другая нейросеть (Image Generator) могла идеально понять контекст, освещение и геометрию объекта.

## ЗАДАЧА
Проанализируй загруженное изображение товара. Твоя цель — извлечь визуальные характеристики для последующей генерации фона и дизайна.
Верни результат СТРОГО в формате JSON.

## ЧТО ИМЕННО АНАЛИЗИРОВАТЬ:

1. **ОБЪЕКТ (СУБЪЕКТ):**
   - Что это? (Название, категория).
   - Материалы и фактура (пример: "глянцевый пластик", "матовая кожа", "прозрачное стекло", "пушистый мех").
   - Основные цвета самого товара.

2. **РАКУРС И ГЕОМЕТРИЯ (КАМЕРА):**
   - Угол съемки (пример: "Front view (0°)", "Three-quarter view (45°)", "Top-down (Flat lay)", "Low angle").
   - Позиция товара в кадре (пример: "Центр", "Смещен вправо").
   - Есть ли обрезка краев товара (кадрирование)?

3. **ОСВЕЩЕНИЕ И ТЕНИ (КРИТИЧНО ВАЖНО ДЛЯ МОНТАЖА):**
   - Тип света (пример: "Мягкий студийный софтбокс", "Жесткий солнечный свет", "Контрастное неоновое").
   - Направление света (откуда падает свет: "Слева-сверху", "Прямо", "Контровой").
   - Тени (пример: "Длинные жесткие тени вправо", "Мягкая рассеянная тень под объектом", "Теней нет/вырезано").
   - Блики (есть ли яркие отражения на товаре?).

4. **ТЕКУЩИЙ ФОН:**
   - Описание (пример: "Белый студийный", "Интерьер кухни", "Улица", "Пёстрый/шумный").
   - Сложность вырезания (пример: "Легко (высокий контраст)", "Сложно (сливается с фоном/волосы/мех)").

## ФОРМАТ ВЫВОДА (JSON ONLY)

\`\`\`json
{
  "visual_analysis": {
    "product_description": {
      "item_name": "Краткое название",
      "materials_texture": "Подробное описание материалов и текстур для промпта (на английском)",
      "dominant_colors": ["#HEX1", "#HEX2"]
    },
    "camera_angle": {
      "type": "Front View | 3/4 View | Top Down | Detail",
      "description": "Описание ракурса на английском (например: 'Eye-level shot, slightly rotated right')"
    },
    "lighting_scenario": {
      "type": "Soft Studio | Hard Sunlight | Cinematic | Flat",
      "direction": "Left | Right | Top | Front | Back",
      "shadows": "Описание теней (на английском, например: 'Soft drop shadow casting to the right')",
      "reflections": "Есть ли блики? (true/false)"
    },
    "composition": {
      "subject_position": "Center | Bottom | Left | Right",
      "background_complexity": "Simple | Complex",
      "isolation_recommendation": "Можно ли легко вырезать фон? (Easy/Hard)"
    }
  },
  "prompt_helper": {
    "recommended_lighting_prompt": "Фраза для промпта, описывающая свет (например: 'soft diffused studio lighting, 4k')",
    "recommended_angle_prompt": "Фраза для промпта, описывающая ракурс (например: 'shot from eye level, 50mm lens')",
    "context_keywords": ["keyword1", "keyword2", "keyword3"]
  }
}`;

/** content_type → промпт ветки. Незнакомый тип идёт в общую ветку. */
export const BRANCH_PROMPTS: Record<string, string> = {
  "fb-target": FB_TARGET_PROMPT,
  "insta-carousel": INSTA_CAROUSEL_PROMPT,
  "instagram-stories": INSTAGRAM_STORIES_PROMPT,
  "neuro-photo": NEURO_PHOTO_PROMPT,
};

export function promptForContentType(contentType: string | null | undefined): string {
  return BRANCH_PROMPTS[(contentType ?? "").trim()] ?? DEFAULT_PROMPT;
}
