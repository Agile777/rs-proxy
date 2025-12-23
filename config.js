// =====================================================
// Retail Solutions Configuration
// Generated: September 13, 2025
// =====================================================

// Application Configuration
window.RETAIL_CONFIG = {
    // Primary Supabase Configuration (Updated to new project ID oqrzmqdkkwnoavawnxxd)
    // NOTE: Never expose secret keys in front-end. Use ONLY publishable (anon) key here.
    SUPABASE_URL: 'https://oqrzmqdkkwnoavawnxxd.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xcnptcWRra3dub2F2YXdueHhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5MjE5MjAsImV4cCI6MjA4MDQ5NzkyMH0.flKzfdZObu05NgMELqFPkhqyPqZO0cJtu2h_zLL7n2I',
    // Do NOT expose service keys in the browser. Keep null here; use server-side only (Edge Functions).
    SUPABASE_SERVICE_KEY: null,
    
    // Fallback Supabase URLs (for automatic recovery)
    SUPABASE_FALLBACK_URLS: [], // (D) Fallbacks removed to prevent environment drift
    
    // Development Mode - enables embedded dev key
    DEV_MODE: false,
    
    // Application Settings
    APP_NAME: 'Retail Solutions',
    VERSION: '1.0.0',
    
    // Debug Settings
    DEBUG_ENABLED: true,

    // Edge Functions base (used for provider proxies like MIE)
    EDGE_FUNCTION_URL: 'https://oqrzmqdkkwnoavawnxxd.functions.supabase.co',

    // Optional: Backend endpoint that exchanges WhatsApp OTP session for a Supabase session
    // Set this to your deployed Edge Function URL, e.g.
    // 'https://<project-ref>.functions.supabase.co/otp-session'
    OTP_SUPABASE_SESSION_URL: 'https://oqrzmqdkkwnoavawnxxd.functions.supabase.co/otp-session', // TODO: ensure edge function deployed
    
    // Staff Search Configuration
    PHONE_SEARCH_FIELDS: ['contact_number', 'mobile_number', 'mobile'],
    
    // Clock-in Configuration
    GPS_REQUIRED: true,
    PHOTO_REQUIRED: false,
    // Optional extended logging to legacy tables; disable by default to avoid 400/409s on mixed schemas
    ENABLE_EXTENDED_CLOCK_LOGGING: false,
    
    // UI Configuration
    THEME: 'default',
    LANGUAGE: 'en',
    
    // SMS API Configuration - SMS Portal
    SMS_API: {
        // Credentials must NOT be exposed in the browser. Auth is handled by the Render proxy.
        CLIENT_ID: null,
        CLIENT_SECRET: null,
        BASE_URL: 'https://rest.smsportal.com',
        SENDER_ID: 'RetailSolutions',
        // Node.js proxy server (deployed on Render.com)
        PROXY_URL: 'https://rs-proxy-1.onrender.com/api/sms' // Production - LIVE
        // PROXY_URL: 'http://127.0.0.1:3001/api/sms' // Local dev server (for testing)
    },
    
    // MIE Background Checks API Configuration - Style Professional (Pty) Ltd
    // NOTE: We are intentionally configured for QA/UAT until UAT is completed.
    // Per MIE: Integration Agent + Integration Endpoint remain INACTIVE on Production until UAT testing is complete.
    MIE_API: {
        // Active environment (default: QA/UAT)
        ENVIRONMENT: 'qa',

        // QA/UAT endpoints (from MIE email thread)
        SOAP_BASE_URL: 'https://qa.mie.co.za/internal/services/epcvrequest/epcvrequest.asmx',
        REST_BASE_URL: 'https://qa.mie.co.za/internal/services/epcvrest',
        WEB_APP_URL: 'https://qa.mie.co.za/internal/apps/portal/core/profile/forgotpassword',

        // QA/UAT Authentication
        USERNAME: 'style_professional_integration_qa',
        EMAIL: 'brandon@retail-solutions.co.za',
        PASSWORD: null, // Do NOT store passwords in client config. Set this in the Edge Function env instead.
        // MIE note: Integration logon source differs from request XML source
        INTEGRATION_LOGON_SOURCE: 'SMARTWEB',

        // Client Configuration
        CLIENT_NAME: 'Style Professional (Pty) Ltd',
        CLIENT_KEY: '20408',
        AGENT_CLIENT_KEY: '20408',
        AGENT_KEY: '54', // QA Environment
        // The source to use in request XML in ksoPutRequest is STYLEPRO
        SOURCE: 'STYLEPRO',

        // API Methods (SOAP)
        METHODS: {
            LOGIN: 'ksoLogin',
            GET_TABLES: 'ksoGetTables',
            GET_ITEM_TYPES: 'ksoGetItemTypes',
            PUT_REQUEST: 'ksoPutRequest'
        },

        // Node.js proxy server (deployed on Render.com)
        PROXY_URL: 'https://rs-proxy-1.onrender.com/api/mie',

        // Keep Production details for reference only (NOT ACTIVE until UAT sign-off)
        PRODUCTION: {
            SOAP_BASE_URL: 'https://www.mie.co.za/secure/services/epcvRequest/epcvRequest.asmx',
            REST_BASE_URL: 'https://mie.co.za/secure/services/epcvrest/api/',
            WEB_APP_URL: 'https://www.mie.co.za/secure/apps/portal/core/profile/forgotpassword',
            USERNAME: 'style_professional_integration_live',
            AGENT_KEY: '82'
        }
    }
};

// Set global configuration for backwards compatibility
window.DEV_MODE = window.RETAIL_CONFIG.DEV_MODE;
window.SUPABASE_URL = window.RETAIL_CONFIG.SUPABASE_URL;
window.SUPABASE_ANON_KEY = window.RETAIL_CONFIG.SUPABASE_ANON_KEY;
// Also expose service key for downstream code that checks presence (do NOT hardcode usage here)
// Do not expose service key to window (security)
// window.SUPABASE_SERVICE_KEY = window.RETAIL_CONFIG.SUPABASE_SERVICE_KEY;

// Help libraries that look for a global functions base
window.SUPABASE_FUNCTIONS_URL = window.RETAIL_CONFIG.EDGE_FUNCTION_URL;

console.log('🔧 Retail Solutions Config loaded', window.RETAIL_CONFIG);

// Ensure favicon is present globally using logo.png (non-auth related)
(function ensureFavicon(){
    try {
        const fallbackDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAQAAACEN3D/AAAAIElEQVQYV2P4////fwYGBgYGEgYGBgYGJgYGBgYGAQAe2wQm2m1wSgAAAABJRU5ErkJggg==';
        const href = 'logo.png';
        let link = document.querySelector('link[rel="icon"]');
        if (!link) {
            link = document.createElement('link');
            link.setAttribute('rel', 'icon');
            link.setAttribute('type', 'image/png');
            document.head.appendChild(link);
        }
        // Try to prefetch logo.png to avoid 404 flicker; fallback to data URL
        function setFavicon(src){
            if (link.getAttribute('href') !== src) link.setAttribute('href', src);
            let apple = document.querySelector('link[rel="apple-touch-icon"]');
            if(!apple){
                apple = document.createElement('link');
                apple.setAttribute('rel', 'apple-touch-icon');
                document.head.appendChild(apple);
            }
            apple.setAttribute('href', src);
        }
        fetch(href, { method:'HEAD' }).then(res => {
            if(res && res.ok){ setFavicon(href); }
            else { setFavicon(fallbackDataUrl); }
        }).catch(()=> setFavicon(fallbackDataUrl));
    } catch(_) { /* non-fatal */ }
})();