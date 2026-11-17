/* ===== Kalin: shared Supabase settings =====
   Edit these once. Every page that loads this file uses them.
   The publishable key is safe in browser code.
   NEVER put a secret or service_role key in any file here. */

const SUPABASE_URL = 'https://tefxdwmuodhfosfrgcad.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2-TtsfmpYavprmwDJlx3TA_NwTvknJl';

const AFTER_LOGIN_URL = 'dashboard.html';
const RESET_REDIRECT_URL = new URL('reset-password.html', window.location.href).href;

// Creates a Supabase client. "storage" decides how long the session lasts:
// localStorage = remembered on this device, sessionStorage = until the tab closes.
function createKalinClient(storage = window.localStorage) {
  return supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { storage, persistSession: true, autoRefreshToken: true }
  });
}
