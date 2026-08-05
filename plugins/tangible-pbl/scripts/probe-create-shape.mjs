#!/usr/bin/env node
// Prints the RAW response shape of the two calls pbl_start_course depends on,
// without any of the plugin's unwrapping. Answers one question: where does the
// course id actually live in the create response?
//
// Reads the same env vars as .mcp.json. Run from plugins/tangible-pbl:
//   TANGIBLE_STAGING_EMAIL=... TANGIBLE_STAGING_PASSWORD=... \
//   node scripts/probe-create-shape.mjs
//
// SIDE EFFECT: creates one throwaway course in staging. Pass --no-create to
// skip that and only probe auth.

const API = process.env.TANGIBLE_STAGING_API_URL
  ?? 'https://tg-dev.arbyte.solutions/tangible/v1';
const EMAIL = process.env.TANGIBLE_STAGING_EMAIL;
const PASSWORD = process.env.TANGIBLE_STAGING_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('Set TANGIBLE_STAGING_EMAIL and TANGIBLE_STAGING_PASSWORD.');
  process.exit(1);
}

const shape = (v, depth = 0) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array[${v.length}] of ${v.length ? shape(v[0], depth + 1) : '?'}`;
  if (typeof v !== 'object') return typeof v;
  if (depth > 2) return '{…}';
  return `{ ${Object.keys(v).map((k) => `${k}: ${shape(v[k], depth + 1)}`).join(', ')} }`;
};

const post = async (path, body, token) => {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  return { status: res.status, parsed, raw };
};

const login = await post('auth/login', { email: EMAIL, password: PASSWORD });
console.log(`\n=== POST auth/login → ${login.status} ===`);
console.log('shape:', shape(login.parsed));
const userToken = login.parsed?.payload?.token ?? login.parsed?.token;
if (!userToken) {
  console.error('No token found. Full body:\n', login.raw.slice(0, 2000));
  process.exit(1);
}

const profileRes = await fetch(`${API}/auth/me`, {
  headers: { Accept: 'application/json', Authorization: `Bearer ${userToken}` },
});
const profile = await profileRes.json().catch(() => undefined);
const userId = profile?.payload?.id ?? profile?.id;
console.log(`\n=== GET auth/me → ${profileRes.status} ===`);
console.log('shape:', shape(profile));

const profile2 = await fetch(`${API}/user/profile/${userId}`, {
  headers: { Accept: 'application/json', Authorization: `Bearer ${userToken}` },
}).then((r) => r.json()).catch(() => undefined);
const memberships = profile2?.payload?.usersInBusiness ?? [];
console.log(`\n=== GET user/profile/:id — usersInBusiness ===`);
console.log('count:', memberships.length);
const businessId = memberships[0]?.businessId
  ?? memberships[0]?.businessUserInBusiness?.id;
console.log('first businessId:', businessId);

const bizLogin = await post('auth/business/login', { businessId }, userToken);
console.log(`\n=== POST auth/business/login → ${bizLogin.status} ===`);
console.log('shape:', shape(bizLogin.parsed));
const bizToken = bizLogin.parsed?.payload?.token ?? bizLogin.parsed?.token;
if (!bizToken) {
  console.error('No business token. Full body:\n', bizLogin.raw.slice(0, 2000));
  process.exit(1);
}

if (process.argv.includes('--no-create')) {
  console.log('\n--no-create given; stopping before course creation.');
  process.exit(0);
}

const created = await post(
  'business/courses',
  { prompt: 'Probe: shape check, safe to delete.' },
  bizToken,
);
console.log(`\n=== POST business/courses → ${created.status} ===`);
console.log('shape:', shape(created.parsed));
console.log('\n--- THIS IS THE ANSWER ---');
console.log('payload keys:', Object.keys(created.parsed?.payload ?? {}));
console.log('payload.id  :', created.parsed?.payload?.id);
console.log('\n--- raw body (first 3000 chars) ---');
console.log(created.raw.slice(0, 3000));
