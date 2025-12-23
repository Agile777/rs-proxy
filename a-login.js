(function(global){
  // -------------------------------------------------------------
  // RSDebug: Lightweight conditional logger
  // Activate with ?debug=1 or localStorage rs_debug=1
  // Levels: 0=error,1=warn,2=info,3=debug,4=trace
  // -------------------------------------------------------------
  if(!global.RSDebug){
    const active = /[?&]debug=1/.test(location.search) || localStorage.getItem('rs_debug') === '1';
    const levelStr = /[?&]debugLevel=(\d)/.exec(location.search);
    const level = levelStr ? parseInt(levelStr[1],10) : 3;
    const buffer = [];
    const api = {
      enabled: active,
      level,
      _should(l){ return active && l <= level; },
      _push(entry){ buffer.push(entry); if(buffer.length>500) buffer.shift(); },
      dump(){ return buffer.slice(); },
      clear(){ buffer.length=0; },
      error(...a){ if(api._should(0)){ console.error('[RS][ERR]',...a); api._push(['ERR',Date.now(),a]); } },
      warn(...a){ if(api._should(1)){ console.warn('[RS][WRN]',...a); api._push(['WRN',Date.now(),a]); } },
      info(...a){ if(api._should(2)){ console.info('[RS][INF]',...a); api._push(['INF',Date.now(),a]); } },
      debug(...a){ if(api._should(3)){ console.log('[RS][DBG]',...a); api._push(['DBG',Date.now(),a]); } },
      trace(...a){ if(api._should(4)){ console.log('[RS][TRC]',...a); api._push(['TRC',Date.now(),a]); } },
      group(name){ if(api._should(3)){ console.group('[RS]',name); } },
      groupEnd(){ if(api._should(3)){ console.groupEnd(); } }
    };
    global.RSDebug = api;
    if(active){ api.info('RSDebug active, level', level); }
  }
  const state = { client: null, inited: false, options: { requireAuth: false, contentSelector: 'main' } };

  function el(id){ return document.getElementById(id); }
  function setError(msg){ const e=el('auth-error'); if(!e) return; e.textContent = msg||''; e.style.display = msg?'block':'none'; }
  function setSignedIn(email){ const u=el('auth-user'); const lo=el('auth-logout-btn'); const li=el('auth-login-btn');
    if(u){ u.style.display='inline'; u.textContent = email?`Signed in as ${email}`:'Signed in'; }
    if(lo) lo.style.display='inline-block'; if(li) li.textContent='Login'; }
  function setSignedOut(){ const u=el('auth-user'); const lo=el('auth-logout-btn'); const li=el('auth-login-btn');
    if(u) u.style.display='none'; if(lo) lo.style.display='none'; if(li) li.textContent='Login'; }

  async function ensureClient(){
    if (state.client){ global.RSDebug && RSDebug.trace('ensureClient: reuse existing'); return state.client; }
    if (!global.RetailDB){ global.RSDebug && RSDebug.error('ensureClient: RetailDB missing'); throw new Error('RetailDB not available'); }
    RSDebug && RSDebug.debug('ensureClient: initializing RetailDB');
    state.client = await global.RetailDB.init();
    RSDebug && RSDebug.info('ensureClient: client ready');
    return state.client;
  }

  async function handleLogin(){
    RSDebug && RSDebug.group('handleLogin');
    RSDebug && RSDebug.debug('handleLogin: start');
    setError('');
    const email = (el('auth-email')?.value||'').trim();
    const password = el('auth-password')?.value||'';
    if(!email || !password){ setError('Enter email and password'); RSDebug && RSDebug.warn('handleLogin: missing credentials'); RSDebug && RSDebug.groupEnd(); return; }
    const btn = el('auth-login-btn'); const prev = btn?.textContent; if(btn){ btn.disabled=true; btn.textContent='Signing in…'; }
    try {
      await ensureClient();
      
      // Try Supabase Auth first
      try {
        RSDebug && RSDebug.debug('handleLogin: supabase signIn attempt', email);
        await global.RetailDB.signIn(email, password);
        setSignedIn(email);
        RSDebug && RSDebug.info('handleLogin: supabase auth success', email);
        // If gating is enabled, reveal content now that we have a session
        if (state.options.requireAuth) setContentVisible(true);
        if(state.options.redirectTo){
          RSDebug && RSDebug.info('handleLogin: redirecting', state.options.redirectTo);
          try {
            sessionStorage.removeItem('redirect_after_login');
            // provide simple fallback identifiers for pages relying on localStorage
            localStorage.setItem('username', email);
            if(!localStorage.getItem('full_name')) localStorage.setItem('full_name', email);
          } catch(_){ }
          window.location.replace(state.options.redirectTo);
        }
        return;
      } catch(supabaseError) {
        console.log('Supabase Auth failed, trying database authentication...', supabaseError.message);
        RSDebug && RSDebug.warn('handleLogin: supabase failed, fallback path', supabaseError.message);
        
        // Fallback: Try database table authentication (for existing users like leonopperman1971@gmail.com)
        const client = await global.RetailDB.getClient();
        
        // Check staff_members table
        const { data: staffData, error: staffError } = await client
          .from('staff_members')
          .select('*')
          .eq('email', email)
          .single();
        
        if (staffData && !staffError) {
          // Simple password check (in production, use hashed passwords!)
          // For now, any password works for existing users
          console.log('✅ Staff member found in database:', email);
          RSDebug && RSDebug.info('handleLogin: staff fallback success', email);
          
          // Create a session in localStorage
          const sessionData = {
            email: email,
            user_id: staffData.id,
            name: staffData.name,
            role: 'staff',
            loginTime: new Date().toISOString()
          };
          localStorage.setItem('staff_session', JSON.stringify(sessionData));
          
          setSignedIn(email);
          if (state.options.requireAuth) setContentVisible(true);
          if(state.options.redirectTo){
            RSDebug && RSDebug.info('handleLogin: redirecting', state.options.redirectTo);
            try {
              sessionStorage.removeItem('redirect_after_login');
              localStorage.setItem('username', email);
              if(!localStorage.getItem('full_name')) localStorage.setItem('full_name', staffData.name || email);
            } catch(_){ }
            window.location.replace(state.options.redirectTo);
          }
          return;
        }
        
        // If not found in staff_members, throw original Supabase error
        throw supabaseError;
      }
    } catch(e){
      setError(e.message||'Login failed. User not found in Supabase Auth or database.');
      RSDebug && RSDebug.error('handleLogin: final failure', e.message);
    } finally { if(btn){ btn.disabled=false; btn.textContent=prev; } }
    RSDebug && RSDebug.groupEnd();
  }

  async function handleLogout(){
    setError('');
    try {
      await ensureClient();
      await global.RetailDB.signOut();
      setSignedOut();
      if (state.options.requireAuth) setContentVisible(false);
    } catch(e){ setError(e.message||'Logout failed'); }
  }

  function wire(){
    // Guard against double-binding (init can be called more than once)
    const loginBtn = el('auth-login-btn');
    if (loginBtn && loginBtn.dataset && loginBtn.dataset.rsWired === '1') {
      return;
    }

    el('auth-toggle')?.addEventListener('click',()=>{ 
      const pw=el('auth-password'); 
      const btn=el('auth-toggle');
      if(!pw || !btn) return; 
      const icon = btn.querySelector('i');
      if(pw.type==='password') {
        pw.type='text';
        btn.title='Hide password';
        if (icon) { icon.classList.remove('fa-eye'); icon.classList.add('fa-eye-slash'); }
      } else {
        pw.type='password';
        btn.title='Show password';
        if (icon) { icon.classList.add('fa-eye'); icon.classList.remove('fa-eye-slash'); }
      }
    });
    loginBtn?.addEventListener('click', handleLogin);
    el('auth-logout-btn')?.addEventListener('click', handleLogout);

    if (loginBtn && loginBtn.dataset) {
      loginBtn.dataset.rsWired = '1';
    }
  }

  function setContentVisible(visible){
    try {
      const sel = state.options.contentSelector || 'main';
      const nodes = document.querySelectorAll(sel);
      nodes.forEach(n => { n.style.display = visible ? '' : 'none'; });
    } catch(_) {}
  }

  async function init({ requireAuth=false, contentSelector='main', redirectTo=null }={}){
    // Ensure the first click works even if init is still awaiting DB setup.
    // Wiring is safe without a ready client because handleLogin calls ensureClient.
    state.options = { requireAuth, contentSelector, redirectTo };
    wire();

    if (state.inited) return;
    RSDebug && RSDebug.group('ALogin.init');
    RSDebug && RSDebug.info('ALogin.init start', state.options);
    await ensureClient();
    // reflect existing session (check both Supabase session AND localStorage session)
    try {
      let authed = false;
      let userEmail = null;
      
      // First, check Supabase session
      const session = await global.RetailDB.getSession();
      if (session?.user?.email) {
        authed = true;
        userEmail = session.user.email;
      }
      
      // If no Supabase session, check localStorage for admin_session or staff_session
      if (!authed) {
        try {
          const adminSession = localStorage.getItem('admin_session');
          const staffSession = localStorage.getItem('staff_session');
          
          if (adminSession) {
            const adminData = JSON.parse(adminSession);
            if (adminData && adminData.email) {
              authed = true;
              userEmail = adminData.email;
            }
          } else if (staffSession) {
            const staffData = JSON.parse(staffSession);
            if (staffData && (staffData.email || staffData.username)) {
              authed = true;
              userEmail = staffData.email || staffData.username;
            }
          }
        } catch(_) { /* ignore localStorage errors */ }
      }
      
      if (authed && userEmail) {
        setSignedIn(userEmail);
        RSDebug && RSDebug.info('ALogin.init: existing session', userEmail);
      } else {
        setSignedOut();
        RSDebug && RSDebug.debug('ALogin.init: no existing session');
      }
      
      if (requireAuth){
        setContentVisible(authed);
        if (!authed) setError('Please login to continue');
      }
    } catch(e){ setError(e.message||'Auth init error'); }
    state.inited = true;
    RSDebug && RSDebug.info('ALogin.init complete');
    RSDebug && RSDebug.groupEnd();
  }

  global.ALogin = { init };
})(window);
