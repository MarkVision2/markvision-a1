// Replacement for `Save And Send` Code node in workflow gJc3C8lTOA7Jv4pN
// Fixes: ReferenceError: fetch is not defined  →  uses n8n built-in this.helpers.httpRequest

const SUPA_URL   = 'https://iywmjdrghcbsicdwohmb.supabase.co/rest/v1/mark_dialogue';
const SUPA_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5d21qZHJnaGNic2ljZHdvaG1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MDk0NzcsImV4cCI6MjA4ODM4NTQ3N30.Km1K3eBIDfSPLWJ42yeKIEQihe3vhKJ0Z-GrCc7AoQI';
const GREEN_URL  = 'https://api.green-api.com/waInstance7103166875/sendMessage/8ecde09ff4af4734a23d35e52ce94bfdce51782abf444a7b90';
const DEBUG_URL  = 'https://iywmjdrghcbsicdwohmb.supabase.co/rest/v1/mark_webhook_debug';

const supaHeaders = {
  apikey: SUPA_KEY,
  Authorization: 'Bearer ' + SUPA_KEY,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

async function http(method, url, body, headers) {
  try {
    const opts = {
      method,
      url,
      headers: headers || { 'Content-Type': 'application/json' },
      json: body !== undefined,
      body: body,
      returnFullResponse: true,
      ignoreHttpStatusErrors: true,
    };
    const r = await this.helpers.httpRequest(opts);
    const txt = typeof r.body === 'string' ? r.body : JSON.stringify(r.body || '');
    return { status: r.statusCode, body: txt.substring(0, 300) };
  } catch (e) {
    return { status: 0, body: String(e).substring(0, 300) };
  }
}
const post = http.bind(this);

const inp = $input.first().json;
const chatId = inp.chatId;
const userMessage = inp.userMessage;

let hist = [];
try {
  const r = await this.helpers.httpRequest({
    method: 'GET',
    url: SUPA_URL + '?chat_id=eq.' + encodeURIComponent(chatId) + '&order=id.desc&limit=20&select=role,message',
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
    json: true,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
  });
  hist = Array.isArray(r.body) ? r.body : [];
  hist.reverse();
} catch (_) { hist = []; }

const botMsgsCount = hist.filter(r => r.role === 'assistant').length;

const scripts = [
  'Добрый день! Меня зовут Юрий, я ведущий специалист отдела развития медицинских клиник. Вы оставили заявку на диагностику и разбор бизнес-процессов вашей клиники — всё верно?',
  'Отлично. У нас это займёт 10–12 минут. Я задам несколько вопросов, чтобы понять вашу ситуацию.',
  'Моя задача — понять, есть ли у вас точки роста. Если результата не будет — честно скажу. Идём в таком формате?',
  'Коротко о нас: команда с 2020 года с медклиниками. За 14 дней привели 107 первичных пациентов, выручка +6 млн ₸. Расскажите что у вас за клиника?',
  'Понял. Что важнее сейчас — увеличить поток пациентов, поднять конверсию или понять где теряются деньги?',
  'Какие основные направления в клинике и на чём зарабатываете больше всего?',
  'Сколько в месяц у вас приходит заявок с рекламы?',
  'Какие каналы используете — Instagram, таргет, Google, рекомендации?',
  'Сколько в месяц тратите на рекламу?',
  'Из всех заявок сколько пациентов реально доходят до клиники?',
  'Где больше всего отваливаются пациенты — на звонке, записи или после?',
  'Кто сейчас обрабатывает заявки и записывает пациентов? Есть скрипты и CRM?',
  'Сколько пациентов в месяц вы хотели бы стабильно получать?',
  'Насколько важно решить эти вопросы сейчас — горящая задача или стратегическая?',
  'Окей, вижу картину. Я могу сделать персональный разбор: на основе ваших данных подготовлю детальный план. Zoom, 60–90 минут, 9 900 ₸ через Каспи. Когда удобнее — сегодня вечером, завтра утром или вечером?',
];

let response;
const lc = (userMessage || '').toLowerCase();
if (lc.includes('дорого') || lc.includes('дороги')) {
  response = 'Понимаю. Но клиники из-за невыстроенной системы теряют сотни тысяч в месяц. У клиники в Алматы после разбора выяснилось что 40% звонков не дозванивались — 600к/мес мимо.';
} else if (lc.includes('подумаю')) {
  response = 'Окей. Скажите честно — сомневаетесь в формате или сейчас не приоритет?';
} else if (lc.includes('кейс') || lc.includes('отзыв')) {
  response = 'Стоматология в Астане — +35% записи за 2 месяца. Клиника в Шымкенте — экономия 800к/мес после разбора каналов.';
} else if (botMsgsCount < scripts.length) {
  response = scripts[botMsgsCount];
} else {
  response = 'Так что насчёт диагностики — подберём время? 9 900 ₸ через Каспи.';
}

const diag = { stage: botMsgsCount, errors: [], status: {} };

let r;
r = await post('POST', DEBUG_URL, { payload: { phase: 'save_send', chatId, userMessage, response: response.substring(0, 200), stage: botMsgsCount } }, supaHeaders);
diag.status.debug = r.status; if (r.status >= 400) diag.errors.push('debug: ' + r.body);

r = await post('POST', SUPA_URL, { chat_id: chatId, role: 'user', message: userMessage }, supaHeaders);
diag.status.user = r.status; if (r.status >= 400) diag.errors.push('user: ' + r.body);

r = await post('POST', SUPA_URL, { chat_id: chatId, role: 'assistant', message: response }, supaHeaders);
diag.status.bot = r.status; if (r.status >= 400) diag.errors.push('bot: ' + r.body);

r = await post('POST', GREEN_URL, { chatId, message: response });
diag.status.send = r.status; diag.send_body = r.body;
if (r.status >= 400) diag.errors.push('send: ' + r.body);

return [{ json: { chatId, response, ...diag } }];
