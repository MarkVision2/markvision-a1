export type TemplateCategory =
  | "first_contact"
  | "followup"
  | "visit"
  | "after_visit"
  | "revival";

export interface MessageTemplate {
  key: string;
  category: TemplateCategory;
  title: string;
  text: string;
}

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: string }[] = [
  { id: "first_contact", label: "Первый контакт" },
  { id: "followup", label: "Дожим" },
  { id: "visit", label: "Запись/визит" },
  { id: "after_visit", label: "После визита" },
  { id: "revival", label: "Возврат" },
];

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    key: "hello",
    category: "first_contact",
    title: "Приветствие",
    text: "Здравствуйте, {name}! Это клиника, вы оставляли заявку на «{service}». Подскажите, в какое время удобно созвониться?",
  },
  {
    key: "price",
    category: "first_contact",
    title: "Прайс",
    text: "{name}, стоимость «{service}» — от {price}. Финальная сумма зависит от объёма работ. Записать вас на бесплатный осмотр?",
  },
  {
    key: "missed_call",
    category: "first_contact",
    title: "Не дозвонились",
    text: "{name}, мы пытались с вами связаться по поводу заявки на «{service}». Когда вам удобно перезвонить?",
  },
  {
    key: "followup_2h",
    category: "followup",
    title: "Повторная попытка",
    text: "{name}, всё ещё актуально по «{service}»? Могу подобрать удобное время и ответить на любые вопросы.",
  },
  {
    key: "followup_objection",
    category: "followup",
    title: "Снять возражение",
    text: "{name}, понимаю ваши сомнения. Давайте я отправлю короткое видео/отзывы и расскажу, что входит в стоимость — без обязательств.",
  },
  {
    key: "book_visit",
    category: "visit",
    title: "Запись на визит",
    text: "{name}, могу записать вас на «{service}». Удобнее в первой или второй половине дня?",
  },
  {
    key: "remind_day_before",
    category: "visit",
    title: "Напоминание за день",
    text: "{name}, напоминаем: завтра ждём вас на «{service}» — {date}. Подтвердите запись, пожалуйста 🙌",
  },
  {
    key: "late",
    category: "visit",
    title: "Опоздание",
    text: "{name}, всё в порядке? У вас сейчас запись на «{service}». Сможете подойти?",
  },
  {
    key: "thanks_paid",
    category: "after_visit",
    title: "Спасибо за оплату",
    text: "{name}, спасибо за доверие! Если появятся вопросы — мы на связи. Будем рады видеть вас снова.",
  },
  {
    key: "ask_review",
    category: "after_visit",
    title: "Запрос отзыва",
    text: "{name}, как вам визит? Будем благодарны за короткий отзыв — это очень помогает нам и другим пациентам.",
  },
  {
    key: "revival_7d",
    category: "revival",
    title: "Возврат через 7 дней",
    text: "{name}, неделю назад вы интересовались «{service}». Сейчас есть удобные слоты и небольшой бонус — рассказать?",
  },
  {
    key: "followup_24h",
    category: "followup",
    title: "Авто-сообщение 24ч",
    text: "{name}, добрый день! Напомню о себе по «{service}». Подскажите, актуально ли ещё? Если есть вопросы — отвечу.",
  },
];