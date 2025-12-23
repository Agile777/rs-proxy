/* retail-database.js
   Centralized Supabase client + Auth utilities for Retail Solutions
   Usage (HTML):
     <script src="config.js"></script>
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.7/dist/umd/supabase.min.js"></script>
     <script src="retail-database.js"></script>
*/
(function(global){
  const CDN_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.7/dist/umd/supabase.min.js';

  const STATE = {
    client: null,
    initialized: false,
    initPromise: null,
  };

  function getConfig(){
    const cfg = global.RETAIL_CONFIG || {};
    const url = global.SUPABASE_URL || cfg.SUPABASE_URL || cfg.url;
    const anon = global.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY || cfg.anonKey || cfg.anon_key;
    return { url, anon };
  }

  function ensureSupabaseLib(){
  if (global.supabase && typeof global.supabase.createClient === 'function') { return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = CDN_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Supabase library'));
      document.head.appendChild(script);
    });
  }

  async function init(options={}){
  if (STATE.initPromise) { return STATE.initPromise; }
    STATE.initPromise = (async () => {
      await ensureSupabaseLib();
  if (STATE.client) { return STATE.client; }
      const { url, anon } = getConfig();
  if (!url || !anon) { throw new Error('Supabase URL/Anon key missing. Ensure config.js defines SUPABASE_URL and SUPABASE_ANON_KEY or RETAIL_CONFIG.'); }

      // If supabase-singleton.js exposes a readiness helper, prefer it to avoid races.
      if (global.waitForSupabaseClient && typeof global.waitForSupabaseClient === 'function') {
        try {
          const existing = await global.waitForSupabaseClient({ timeoutMs: 12000, intervalMs: 120 });
          if (existing && typeof existing.from === 'function' && !existing.offline) {
            console.log('[retail-database] Found and reusing Supabase singleton client');
            STATE.client = existing;
          }
        } catch (_e) {
          // Fall back to polling below
        }
      }

      // If we already got a good client, publish and return immediately.
      if (STATE.client) {
        try { if (!window.__SUPABASE_CLIENT__) { window.__SUPABASE_CLIENT__ = STATE.client; } } catch(_){ }
        try { if (!window.supabaseSingleton) { window.supabaseSingleton = STATE.client; } } catch(_){ }
        try { global._supabase = STATE.client; } catch(_){ }
        try { if (!global.supabaseClient) { global.supabaseClient = { supabase: STATE.client }; } } catch(_){ }
        STATE.initialized = true;
        return STATE.client;
      }

      // Wait for supabase-singleton.js to finish creating the client (max 5 seconds)
      let attempts = 0;
      const maxAttempts = 120; // 120 * 100ms = 12 seconds
      
      while (attempts < maxAttempts) {
        const existing = window.supabaseSingleton || window.__SUPABASE_CLIENT__;
        
        if (existing && typeof existing.from === 'function' && !existing.offline) {
          console.log('[retail-database] Found and reusing Supabase singleton client');
          STATE.client = existing;
          break;
        }
        
        // Wait 100ms before checking again
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (STATE.client) {
        try { if (!window.__SUPABASE_CLIENT__) { window.__SUPABASE_CLIENT__ = STATE.client; } } catch(_){ }
        try { if (!window.supabaseSingleton) { window.supabaseSingleton = STATE.client; } } catch(_){ }
        try { global._supabase = STATE.client; } catch(_){ }
        try { if (!global.supabaseClient) { global.supabaseClient = { supabase: STATE.client }; } } catch(_){ }
        STATE.initialized = true;
        return STATE.client;
      }
      
      // If singleton still not found after waiting, check other locations or create new client
      if (!STATE.client) {
        const fallback = window._supabase || (window.supabaseClient && window.supabaseClient.supabase) || null;
        
        if (fallback && typeof fallback.from === 'function') {
          console.log('[retail-database] Using fallback Supabase client');
          STATE.client = fallback;
        } else {
          console.warn('[retail-database] Singleton not ready after 12 seconds, creating new client');
          STATE.client = global.supabase.createClient(url, anon, {
            auth: { 
              persistSession: true, 
              autoRefreshToken: true, 
              detectSessionInUrl: true,
              storageKey: 'sb-singleton-session' // Use same storage key as singleton
            }
          });
        }
      }

      // Publish as singleton so other scripts/pages can reuse it.
      try { if (!window.__SUPABASE_CLIENT__) { window.__SUPABASE_CLIENT__ = STATE.client; } } catch(_){ }
      try { if (!window.supabaseSingleton) { window.supabaseSingleton = STATE.client; } } catch(_){ }
      
      try { global._supabase = STATE.client; } catch(_){}
  try { if (!global.supabaseClient) { global.supabaseClient = { supabase: STATE.client }; } } catch(_){ }

      STATE.initialized = true;
      return STATE.client;
    })();
    return STATE.initPromise;
  }

  function getClient(){
  if (!STATE.client) { throw new Error('RetailDB not initialized. Call RetailDB.init() first.'); }
    return STATE.client;
  }

  async function getSession(){
    const client = getClient();
    const { data: { session } = { session: null } } = await client.auth.getSession();
    return session || null;
  }

  function onAuthStateChanged(cb){
    const client = getClient();
    return client.auth.onAuthStateChange((_event, session) => cb(session));
  }

  async function signIn(email, password){
    const client = getClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) { throw error; }
    return data;
  }

  async function signOut(){
    const client = getClient();
    await client.auth.signOut();
  }

  async function attachStaffSession(staffInfo={}){
    const endpoint = (global.RETAIL_CONFIG && global.RETAIL_CONFIG.OTP_SUPABASE_SESSION_URL) || global.OTP_SUPABASE_SESSION_URL || null;
    if (!endpoint) { throw new Error('OTP_SUPABASE_SESSION_URL not configured'); }

    await init();
    const client = STATE.client;
    if (!client) { throw new Error('Supabase client not initialized'); }

    const staffId = staffInfo.staffId ?? staffInfo.staff_id ?? staffInfo.id ?? null;
    if (!staffId) { throw new Error('attachStaffSession requires staffId'); }

    const firstName = staffInfo.firstName || staffInfo.first_name || staffInfo.name || '';
    const surname = staffInfo.surname || staffInfo.lastName || staffInfo.last_name || staffInfo.sur_name || '';
    const mobile = staffInfo.mobile || staffInfo.mobileNumber || staffInfo.phone || staffInfo.cellphone_number || staffInfo.contact_number || null;

    let deviceId = null;
    try {
      if (global.WhatsAppOTP && typeof global.WhatsAppOTP.getDeviceFingerprint === 'function') {
        deviceId = global.WhatsAppOTP.getDeviceFingerprint();
      } else if (global.localStorage) {
        deviceId = global.localStorage.getItem('device_fingerprint') || global.localStorage.getItem('WhatsApp_device_fingerprint') || null;
      }
    } catch(_){ deviceId = null; }

    const payload = {
      staffId,
      mobile,
      firstName,
      surname,
      deviceId: deviceId || undefined
    };

    let tokens = null;
    try {
      if (client.functions && typeof client.functions.invoke === 'function') {
        const { data, error } = await client.functions.invoke('otp-session', { body: payload });
        if (error) { throw error; }
        tokens = data;
      }
    } catch (invokeErr) {
      console.warn('[RetailDB] otp-session invoke failed, falling back to fetch:', invokeErr);
    }

    if (!tokens) {
      const headers = { 'Content-Type': 'application/json' };
      const anonKey = (global.RETAIL_CONFIG && global.RETAIL_CONFIG.SUPABASE_ANON_KEY) || global.SUPABASE_ANON_KEY || null;
      const authToken = anonKey || null;
      if (anonKey) { headers.apikey = anonKey; }
      if (authToken) { headers.Authorization = 'Bearer ' + authToken; }
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        mode: 'cors',
        credentials: 'omit'
      });
      if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        throw new Error('Session endpoint returned ' + resp.status + (detail ? ' - ' + detail : ''));
      }
      tokens = await resp.json();
    }

    if (!tokens || !tokens.access_token || !tokens.refresh_token) { throw new Error('Missing tokens in response'); }

    const { error: setErr } = await client.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    });
    if (setErr) { throw setErr; }
    try {
      const statusEl = global.document ? global.document.getElementById('ss-status') : null;
      if (statusEl) { statusEl.textContent = 'Signed in (secure)'; }
    } catch(_){ }
    return true;
  }

  // Build or attach to a login UI in a container
  function attachLoginUI({ container, onSuccess } = {}){
    const el = (typeof container === 'string') ? document.querySelector(container) : container;
  if (!el) { throw new Error('attachLoginUI: container not found'); }

    // If container already has inputs, just wire them; else render minimal form
    if (!el.querySelector('form')) {
      el.innerHTML = `
        <h2 style="margin-bottom:12px;text-align:center;color:#2563eb;">Login</h2>
        <form id="retaildb-login-form">
          <div style="margin-bottom:10px;">
            <label style="font-weight:500;">Email</label>
            <input type="email" id="retaildb-email" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;" />
          </div>
          <div style="margin-bottom:10px;position:relative;">
            <label style="font-weight:500;">Password</label>
            <input type="password" id="retaildb-password" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;" />
            <button type="button" id="retaildb-toggle" style="position:absolute;right:10px;top:32px;background:none;border:none;cursor:pointer;">👁️</button>
          </div>
          <button type="submit" style="width:100%;padding:10px 0;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:1rem;cursor:pointer;">Login</button>
          <div id="retaildb-error" style="display:none;color:#b91c1c;background:#fee2e2;border:1px solid #fca5a5;padding:8px;border-radius:6px;margin-top:10px;"></div>
        </form>`;
    }

    const form = el.querySelector('form') || el.querySelector('#retaildb-login-form');
    const emailEl = el.querySelector('input[type="email"], #retaildb-email');
    const passEl = el.querySelector('input[type="password"], #retaildb-password');
    const errEl = el.querySelector('#retaildb-error') || (()=>{ const d=document.createElement('div'); d.id='retaildb-error'; d.style.display='none'; el.appendChild(d); return d; })();
    const toggle = el.querySelector('#retaildb-toggle');
    if (toggle && passEl) {
      toggle.addEventListener('click', ()=>{ passEl.type = passEl.type === 'password' ? 'text' : 'password'; });
    }
    if (form) {
      form.addEventListener('submit', async (e)=>{
        e.preventDefault();
        errEl.style.display='none';
        try {
          await signIn(emailEl.value.trim(), passEl.value);
          if (typeof onSuccess === 'function') { onSuccess(); }
        } catch (err) {
          errEl.textContent = err.message || 'Login failed';
          errEl.style.display = 'block';
        }
      });
    }
  }

  async function ensureAuth({ requireAuth=true, loginPage='index.html', inline }={}){
    const client = await init();
    const { data: { session } = { session: null } } = await client.auth.getSession();
  if (session) { return session; }

    if (inline && inline.container) {
      // Inline login flow
      attachLoginUI({ container: inline.container, onSuccess: async ()=>{
        const s = await getSession();
  if (s && typeof inline.onSuccess === 'function') { inline.onSuccess(s); }
      }});
      // Do not redirect; caller should wait for onSuccess
      return null;
    }

    if (requireAuth) {
      // Fallback redirect
      window.location.href = loginPage;
    }
    return null;
  }

  function from(table){
    return getClient().from(table);
  }

  // Public API
  const RetailDB = {
    init, getClient, getSession, onAuthStateChanged,
    signIn, signOut, ensureAuth, from, attachLoginUI,
    // Dev helpers will be appended below
  };

  // -------------------------------------------------
  // Defensive Accessors
  // -------------------------------------------------
  const __supabaseReadyCallbacks = [];
  let __supabaseReadyDispatched = false;

  function dispatchSupabaseReady(){
  if (__supabaseReadyDispatched) { return; }
    __supabaseReadyDispatched = true;
    try { window.dispatchEvent(new CustomEvent('supabase:ready', { detail: { ts: Date.now() }})); } catch(_){ }
    while (__supabaseReadyCallbacks.length) {
      const cb = __supabaseReadyCallbacks.shift();
      try { cb(STATE.client); } catch(_){ }
    }
  }

  // Wrap original init to fire event/callbacks
  const _origInit = RetailDB.init;
  RetailDB.init = async function(...args){
    const c = await _origInit.apply(RetailDB, args);
    dispatchSupabaseReady();
    return c;
  };

  // Wait for a ready client (poll + event) with timeout
  async function waitForSupabase(timeoutMs = 6000){
    try {
  if (!STATE.initialized) { await RetailDB.init(); }
  if (STATE.client) { return STATE.client; }
    } catch(_) { /* continue to wait */ }
    const start = Date.now();
    return await new Promise((resolve, reject) => {
      const interval = 120;
      const tick = () => {
        if (STATE.client) { return resolve(STATE.client); }
        if (Date.now() - start >= timeoutMs) {
          return reject(new Error('waitForSupabase timeout after '+timeoutMs+'ms')); }
        setTimeout(tick, interval);
      };
      // Also hook into readiness callbacks
      onSupabaseReady(c => resolve(c));
      tick();
    });
  }

  function onSupabaseReady(cb){
    if (STATE.client) { try { cb(STATE.client); } catch(_){ } return; }
    __supabaseReadyCallbacks.push(cb);
  }

  // Expose helpers
  RetailDB.waitForSupabase = waitForSupabase;
  RetailDB.onSupabaseReady = onSupabaseReady;
  RetailDB.attachStaffSession = attachStaffSession;

  // If already initialized (race) dispatch readiness now
  if (STATE.initialized && STATE.client) {
    setTimeout(dispatchSupabaseReady, 0);
  } else {
    // Lazy probe in case someone loaded this after client creation elsewhere
    setTimeout(()=>{
      try {
        if (!STATE.client && window._supabase && typeof window._supabase.from === 'function') {
          STATE.client = window._supabase; STATE.initialized = true; dispatchSupabaseReady();
        }
      } catch(_){}
    }, 0);
  }

  global.RetailDB = RetailDB;
})(window);

// =============================================================
// Dev / Admin Bypass Helper (centralized)
// =============================================================
(function(){
  if(window.RetailDB && !window.RetailDB.devBypass){
    window.RetailDB.devBypass = function(email, opts={}){
      const target = (email||'').toLowerCase();
      const DEV_EMAIL = 'leonopperman1971@gmail.com';
  if(!window.DEV_MODE) { return false; }
  if(target !== DEV_EMAIL) { return false; }
      const sessionData = {
        email: DEV_EMAIL,
        username: 'Leon Opperman',
        userId: opts.userId || 'admin-dev-bypass',
        loginTime: new Date().toISOString(),
        userType: 'admin',
        bypass: true
      };
      const staffCandidate = opts.staff || {};
      const ensureStaff = {
        staffId: staffCandidate.staffId || staffCandidate.staff_id || opts.staffId || opts.staff_id || null,
        firstName: staffCandidate.firstName || staffCandidate.name || opts.firstName || 'Leon',
        surname: staffCandidate.surname || staffCandidate.lastName || opts.lastName || 'Opperman',
        mobile: staffCandidate.mobile || staffCandidate.mobileNumber || opts.mobile || opts.phone || '0815538838'
      };
      if (!ensureStaff.staffId && target === DEV_EMAIL) { ensureStaff.staffId = 5151; }
      if (!sessionData.staffId && ensureStaff.staffId) { sessionData.staffId = ensureStaff.staffId; }
      try {
        localStorage.setItem('admin_session', JSON.stringify(sessionData));
        localStorage.setItem('user_id', sessionData.userId);
        localStorage.setItem('user_name', sessionData.username);
        localStorage.setItem('role', 'admin');
        localStorage.setItem('username', DEV_EMAIL);
      } catch(_) {}
      if (ensureStaff.staffId && typeof window.RetailDB.attachStaffSession === 'function') {
        window.RetailDB.attachStaffSession(ensureStaff)
          .then(() => console.log('Dev bypass Supabase session attached'))
          .catch(err => console.warn('Dev bypass Supabase session attach failed:', err));
      }
      try { window.dispatchEvent(new CustomEvent('dev:bypass',{detail:{email:DEV_EMAIL}})); } catch(_){ }
      return true;
    };
  }
})();

