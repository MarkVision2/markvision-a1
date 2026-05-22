#!/usr/bin/env node
// Patches the AI-targetolog1 n8n workflow:
//   1. customerGreeting (pre-filled WhatsApp message from client)
//      → "Хочу получить систему привлечения первичных пациентов"
//   2. welcomeMessage (business reply shown after click)
//      → "Только для владельцев медицинских клиник и стоматологий"
//
// Usage:
//   N8N_API_KEY=<token> node scripts/patch-n8n-whatsapp-greeting.mjs
//
// Optional env:
//   N8N_BASE_URL   (default https://n8n.zapoinov.com)
//   N8N_WORKFLOW_ID (default LncxAleDlMPOb3hP)
//   DRY_RUN=1      print diff without PUT

const BASE   = process.env.N8N_BASE_URL    || 'https://n8n.zapoinov.com';
const WF_ID  = process.env.N8N_WORKFLOW_ID || 'LncxAleDlMPOb3hP';
const TOKEN  = process.env.N8N_API_KEY;
const DRY    = process.env.DRY_RUN === '1';

if (!TOKEN) { console.error('N8N_API_KEY env is required'); process.exit(1); }

const CUSTOMER_GREETING = 'Хочу получить систему привлечения первичных пациентов';
const WELCOME_MESSAGE   = 'Только для владельцев медицинских клиник и стоматологий';

const headers = { 'X-N8N-API-KEY': TOKEN, 'Accept': 'application/json' };

console.log(`[GET] ${BASE}/api/v1/workflows/${WF_ID}`);
const getResp = await fetch(`${BASE}/api/v1/workflows/${WF_ID}`, { headers });
console.log(`[GET] status=${getResp.status}`);
if (!getResp.ok) {
  const txt = await getResp.text();
  throw new Error(`GET ${getResp.status}: ${txt}`);
}
const wf = await getResp.json();
console.log(`[GET] ok name="${wf.name}" nodes=${(wf.nodes || []).length}`);

const node = (wf.nodes || []).find(n => n.name === 'Parse JSON1');
if (!node) throw new Error('Parse JSON1 node not found');

const code = node.parameters?.jsCode;
if (typeof code !== 'string') throw new Error('Parse JSON1 has no jsCode');

const OLD_GREETING_BLOCK = `const customerGreeting = (plan && typeof plan.customerGreeting === 'string' && plan.customerGreeting.trim())
  ? plan.customerGreeting.trim()
  : '';
const waPrefill = customerGreeting || triggerWord || '';`;

const NEW_GREETING_BLOCK = `// Fixed customer pre-fill for MarkVision project
const customerGreeting = ${JSON.stringify(CUSTOMER_GREETING)};
const waPrefill = customerGreeting;`;

const OLD_WELCOME_LINE = `const welcomeMsg = !isWebsite && !isLeadForm && !isInstagram && plan.welcomeMessage`;
const NEW_WELCOME_LINE = `const welcomeMsg = !isWebsite && !isLeadForm && !isInstagram`;
const OLD_WELCOME_TEXT = `          text: plan.welcomeMessage,`;
const NEW_WELCOME_TEXT = `          text: ${JSON.stringify(WELCOME_MESSAGE)},`;

function applyOnce(src, oldStr, newStr, label) {
  const parts = src.split(oldStr);
  if (parts.length === 1) throw new Error(`Patch target not found: ${label}`);
  if (parts.length > 2)   throw new Error(`Patch target not unique (${parts.length - 1} matches): ${label}`);
  return parts.join(newStr);
}

let patched = code;
patched = applyOnce(patched, OLD_GREETING_BLOCK, NEW_GREETING_BLOCK, 'customerGreeting block');
patched = applyOnce(patched, OLD_WELCOME_LINE,   NEW_WELCOME_LINE,   'welcomeMsg condition');
patched = applyOnce(patched, OLD_WELCOME_TEXT,   NEW_WELCOME_TEXT,   'welcomeMessage text');

if (patched === code) { console.log('Already patched, nothing to do'); process.exit(0); }

node.parameters.jsCode = patched;

if (DRY) {
  console.log('DRY RUN — would PUT updated workflow. Patched node:', node.name);
  process.exit(0);
}

// n8n API rejects unknown fields on PUT — strip read-only ones
const payload = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings || {},
  staticData: wf.staticData ?? null,
};

console.log(`[PUT] ${BASE}/api/v1/workflows/${WF_ID} (payload keys: ${Object.keys(payload).join(',')})`);
const put = await fetch(`${BASE}/api/v1/workflows/${WF_ID}`, {
  method: 'PUT',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const putBody = await put.text();
console.log(`[PUT] status=${put.status} body=${putBody.slice(0, 500)}`);
if (!put.ok) throw new Error(`PUT failed`);

// Verify the patch by re-GETting
console.log(`[VERIFY] re-fetching workflow…`);
const verify = await fetch(`${BASE}/api/v1/workflows/${WF_ID}`, { headers }).then(r => r.json());
const verifyNode = (verify.nodes || []).find(n => n.name === 'Parse JSON1');
const verifyCode = verifyNode?.parameters?.jsCode || '';
const okGreeting = verifyCode.includes(CUSTOMER_GREETING);
const okWelcome  = verifyCode.includes(WELCOME_MESSAGE);
console.log(`[VERIFY] customerGreeting applied: ${okGreeting}`);
console.log(`[VERIFY] welcomeMessage applied:   ${okWelcome}`);
if (!okGreeting || !okWelcome) {
  throw new Error('PUT succeeded but verification failed — n8n did not persist the patch');
}
console.log('Workflow patched and verified successfully.');
