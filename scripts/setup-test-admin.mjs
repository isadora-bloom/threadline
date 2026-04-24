import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import fs from 'fs';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing SUPABASE env');
  process.exit(1);
}

const email = 'pw-admin@threadline.test';
const password = 'Test-Admin-' + Date.now();
const CURRENT_TOS_VERSION = '2026-03';

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

// Does the user already exist? Supabase has no direct lookup by email, so list and filter.
async function findUser(email) {
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page++;
  }
}

let user = await findUser(email);
if (user) {
  console.log('user exists, resetting password:', user.id);
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
    user_metadata: {
      ...user.user_metadata,
      tos_accepted_at: new Date().toISOString(),
      tos_accepted_version: CURRENT_TOS_VERSION,
    },
  });
  if (error) throw error;
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      tos_accepted_at: new Date().toISOString(),
      tos_accepted_version: CURRENT_TOS_VERSION,
    },
  });
  if (error) throw error;
  user = data.user;
  console.log('created user:', user.id);
}

// Upsert user_profiles
await admin.from('user_profiles').upsert({
  id: user.id,
  accepted_tos_at: new Date().toISOString(),
  accepted_tos_version: CURRENT_TOS_VERSION,
});

// Grant lead_investigator on all system cases
const systemCaseTitles = [
  'NamUs Import — Missing Persons',
  'NamUs Import — Unidentified Remains',
  'Doe Network Import — Missing Persons',
  'Doe Network Import — Unidentified Persons',
  'Doe Network Import — Unidentified Remains',
  'Charley Project Import — Missing Persons',
];

const { data: systemCases, error: caseErr } = await admin
  .from('cases')
  .select('id, title')
  .in('title', systemCaseTitles);
if (caseErr) throw caseErr;
console.log('found system cases:', systemCases?.length);

for (const c of systemCases ?? []) {
  const { error } = await admin
    .from('case_user_roles')
    .upsert(
      { case_id: c.id, user_id: user.id, role: 'lead_investigator' },
      { onConflict: 'case_id,user_id' }
    );
  if (error) console.error('role upsert failed for', c.title, error.message);
}

fs.writeFileSync(
  '.pw-check/creds.json',
  JSON.stringify({ email, password, userId: user.id }, null, 2)
);
console.log(`\nemail: ${email}\npassword: ${password}\nuserId: ${user.id}`);
