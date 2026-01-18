import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

function loadLocalSecrets(){
  try {
    const candidates = [
      path.join(process.cwd(), 'secrets.local.json'),
      path.join(__dirname, 'secrets.local.json')
    ];
    const filePath = candidates.find(p => fs.existsSync(p));
    if (!filePath) return null;

    const raw = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(raw);
    return json && typeof json === 'object' ? json : null;
  } catch (_) {
    return null;
  }
}

function getSupabaseServiceSecrets(){
  const secrets = loadLocalSecrets();
  const url = process.env.SUPABASE_URL || secrets?.SUPABASE_URL || secrets?.supabase_url || null;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || secrets?.SUPABASE_SERVICE_ROLE_KEY || secrets?.SUPABASE_SERVICE_KEY || secrets?.supabase_service_role_key || secrets?.supabase_service_key || null;
  const anonKey = process.env.SUPABASE_ANON_KEY || secrets?.SUPABASE_ANON_KEY || secrets?.supabase_anon_key || null;
  const proxyKey = process.env.PROXY_API_KEY || secrets?.PROXY_API_KEY || secrets?.proxy_api_key || null;
  const allowedEmailsRaw = process.env.ALLOWED_SCHEDULER_EMAILS || secrets?.ALLOWED_SCHEDULER_EMAILS || secrets?.allowed_scheduler_emails || '';
  const allowedDomainsRaw = process.env.ALLOWED_SCHEDULER_DOMAINS || secrets?.ALLOWED_SCHEDULER_DOMAINS || secrets?.allowed_scheduler_domains || '';
  const allowedEmails = String(allowedEmailsRaw || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const allowedDomains = String(allowedDomainsRaw || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return { url, serviceKey, anonKey, proxyKey, allowedEmails, allowedDomains };
}

function isLocalRequest(req){
  try {
    const ip = String(req.ip || '').replace('::ffff:', '');
    return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
  } catch (_) {
    return false;
  }
}

function getBearerToken(req){
  const h = req.header('authorization') || '';
  const m = String(h).match(/^\s*Bearer\s+(.+)\s*$/i);
  return m && m[1] ? m[1].trim() : null;
}

async function verifySupabaseUser({ url, apikey, token }){
  const base = String(url || '').replace(/\/$/, '');
  const resp = await fetch(base + '/auth/v1/user', {
    method: 'GET',
    headers: {
      apikey: apikey,
      Authorization: `Bearer ${token}`
    }
  });
  const text = await resp.text().catch(() => '');
  if (!resp.ok) {
    return { ok: false, status: resp.status, detail: text.slice(0, 2000) };
  }
  try {
    const user = JSON.parse(text);
    return { ok: true, user };
  } catch (_) {
    return { ok: false, status: 502, detail: 'Could not parse user payload' };
  }
}

function emailAllowed(email, { allowedEmails, allowedDomains }){
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  if (Array.isArray(allowedEmails) && allowedEmails.includes(e)) return true;
  const domain = e.includes('@') ? e.split('@').pop() : '';
  if (!domain) return false;
  if (Array.isArray(allowedDomains) && allowedDomains.includes(domain)) return true;
  return false;
}

function cdataWrap(value) {
  const s = String(value ?? '');
  // Safely split any occurrence of ']]>'
  const safe = s.replaceAll(']]>', ']]]]><![CDATA[>');
  return `<![CDATA[${safe}]]>`;
}

function extractTagText(xml, tagName) {
  if (!xml) return null;
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}

function extractRequestKey(text) {
  if (!text) return null;
  // Common patterns seen in vendor XML payloads
  const patterns = [
    /<RequestKey>([^<]+)<\/RequestKey>/i,
    /RequestKey\s*=\s*"([^"]+)"/i,
    /RequestKey\s*:\s*([A-Za-z0-9_-]+)/i
  ];
  for (const re of patterns) {
    const m = String(text).match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

app.get('/health', (req, res) => {
  const secrets = loadLocalSecrets();
  const supa = getSupabaseServiceSecrets();
  res.json({
    ok: true,
    service: 'rs-local-proxy',
    port: PORT,
    time: new Date().toISOString(),
    cwd: process.cwd(),
    secretsFileDetected: Boolean(secrets),
    envVariablesDetected: {
      MIE_PASSWORD: !!process.env.MIE_PASSWORD,
      MIE_USERNAME: !!process.env.MIE_USERNAME,
      SMS_CLIENT_SECRET: !!process.env.SMS_CLIENT_SECRET,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY
    }
    ,supabaseDetected: {
      url: Boolean(supa.url),
      serviceKey: Boolean(supa.serviceKey),
      proxyKeyRequired: Boolean(supa.proxyKey)
    },
    hints: {
      shiftsSchedule: 'POST /api/shifts/schedule requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (env or secrets.local.json).',
      payslips: 'POST /api/payslips requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (env or secrets.local.json).'
    }
  });
});

// Payslips save endpoint - stores generated payslip data
// Body: { staff_id, staff_name, payment_period_start, payment_period_end, regular_hours, overtime_hours, total_earnings, total_deductions, nett_pay }
app.post('/api/payslips', async (req, res) => {
  try {
    const { url, serviceKey } = getSupabaseServiceSecrets();

    if (!url || !serviceKey) {
      return res.status(500).json({
        ok: false,
        error: 'Supabase service role not configured on proxy',
        hint: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env or secrets.local.json'
      });
    }

    const body = req.body || {};
    
    // Validate required fields
    const requiredFields = ['staff_id', 'staff_name', 'payment_period_start', 'payment_period_end'];
    for (const field of requiredFields) {
      if (!body[field]) {
        return res.status(400).json({ ok: false, error: `Missing required field: ${field}` });
      }
    }

    // Prepare payslip record - map to existing payslips table schema
    const payslipData = {
      staff_row_id: body.staff_id ? Number(body.staff_id) : null,
      staff_data_number: String(body.staff_id || '').trim(),
      staff_name: String(body.staff_name || '').trim(),
      pay_period_start: String(body.payment_period_start || '').trim(),
      pay_period_end: String(body.payment_period_end || '').trim(),
      payment_date: new Date().toISOString().split('T')[0],
      regular_hours: parseFloat(body.regular_hours || 0),
      overtime_hours: parseFloat(body.overtime_hours || 0),
      total_hours: parseFloat((body.regular_hours || 0)) + parseFloat((body.overtime_hours || 0)),
      gross_pay: parseFloat(body.regular_cost || 0) + parseFloat(body.overtime_cost || 0),
      overtime_pay: parseFloat(body.overtime_cost || 0),
      bonus: 0,
      allowances: 0,
      total_earnings: parseFloat(body.total_earnings || 0),
      tax_deduction: 0,
      uif_deduction: 0,
      pension_deduction: 0,
      medical_aid_deduction: 0,
      uniform_deduction: 0,
      other_deductions: 0,
      total_deductions: parseFloat(body.total_deductions || 0),
      net_pay: parseFloat(body.nett_pay || 0),
      status: 'generated',
      created_at: new Date().toISOString()
    };

    // Insert into Supabase
    const restUrl = url.replace(/\/$/, '') + '/rest/v1/payslips';
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    };

    const insertResp = await fetch(restUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payslipData)
    });

    if (!insertResp.ok) {
      const errorText = await insertResp.text().catch(() => '');
      console.error('[PAYSLIPS] Insert failed:', insertResp.status, errorText);
      return res.status(insertResp.status).json({
        ok: false,
        error: 'Failed to save payslip to database',
        detail: errorText.slice(0, 500)
      });
    }

    const result = await insertResp.json().catch(() => ({}));
    res.json({ ok: true, payslip: result });

  } catch (err) {
    console.error('[PAYSLIPS] Error:', err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Shifts schedule save endpoint (server-side Supabase service role; intended for local/dev)
// Body: { customer_id, site_id, week_start, week_end, shifts: [...] }
app.post('/api/shifts/schedule', async (req, res) => {
  try {
    const { url, serviceKey, anonKey, proxyKey, allowedEmails, allowedDomains } = getSupabaseServiceSecrets();

    if (proxyKey) {
      const provided = req.header('x-rs-proxy-key') || '';
      if (String(provided) !== String(proxyKey)) {
        return res.status(401).json({ ok: false, error: 'Unauthorized (missing/invalid proxy key)' });
      }
    } else {
      // No proxy key configured: restrict to local requests only
      if (!isLocalRequest(req)) {
        return res.status(403).json({ ok: false, error: 'Forbidden (local requests only)' });
      }
    }

    if (!url || !serviceKey) {
      return res.status(500).json({
        ok: false,
        error: 'Supabase service role not configured on proxy',
        hint: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env or secrets.local.json'
      });
    }

    // Production-safe gate: require a valid Supabase access token and allowlist.
    // (Local dev can bypass allowlist when the request is local AND no allowlist is configured.)
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Missing Authorization bearer token (Supabase access token required)' });
    }

    const verify = await verifySupabaseUser({ url, apikey: anonKey || serviceKey, token });
    if (!verify.ok) {
      return res.status(401).json({ ok: false, error: 'Invalid/expired Supabase token', detail: verify.detail || null });
    }

    const email = verify.user?.email || verify.user?.user_metadata?.email || null;
    const hasAllowlist = (allowedEmails && allowedEmails.length) || (allowedDomains && allowedDomains.length);
    const localBypass = isLocalRequest(req) && !hasAllowlist;
    if (!localBypass) {
      if (!hasAllowlist) {
        return res.status(500).json({
          ok: false,
          error: 'Scheduler allowlist not configured on proxy',
          hint: 'Set ALLOWED_SCHEDULER_EMAILS (comma-separated) and/or ALLOWED_SCHEDULER_DOMAINS in proxy env'
        });
      }
      if (!emailAllowed(email, { allowedEmails, allowedDomains })) {
        return res.status(403).json({ ok: false, error: 'Forbidden: user not allowed to save schedules', email });
      }
    }

    const body = req.body || {};
    const customerId = Number.parseInt(String(body.customer_id ?? ''), 10);
    const siteId = Number.parseInt(String(body.site_id ?? ''), 10);
    const weekStart = String(body.week_start || '').trim();
    const weekEnd = String(body.week_end || '').trim();
    const shifts = Array.isArray(body.shifts) ? body.shifts : [];

    if (!Number.isFinite(customerId) || !Number.isFinite(siteId)) {
      return res.status(400).json({ ok: false, error: 'Missing/invalid customer_id or site_id' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !/^\d{4}-\d{2}-\d{2}$/.test(weekEnd)) {
      return res.status(400).json({ ok: false, error: 'Missing/invalid week_start or week_end (YYYY-MM-DD)' });
    }
    if (!shifts.length) {
      return res.status(400).json({ ok: false, error: 'No shifts provided' });
    }
    if (shifts.length > 5000) {
      return res.status(413).json({ ok: false, error: 'Too many shifts in one request' });
    }

    const restBase = url.replace(/\/$/, '') + '/rest/v1/shifts';
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    };

    // Delete existing week/site/customer shifts (clean slate)
    const delUrl = `${restBase}?customer_id=eq.${encodeURIComponent(String(customerId))}` +
      `&site_id=eq.${encodeURIComponent(String(siteId))}` +
      `&shift_date=gte.${encodeURIComponent(weekStart)}` +
      `&shift_date=lte.${encodeURIComponent(weekEnd)}`;

    const delResp = await fetch(delUrl, {
      method: 'DELETE',
      headers: {
        ...headers,
        Prefer: 'count=exact'
      }
    });

    if (!delResp.ok) {
      const detail = await delResp.text().catch(() => '');
      return res.status(502).json({ ok: false, error: `Supabase delete failed (${delResp.status})`, detail: detail.slice(0, 2000) });
    }

    // Insert new shifts
    const insResp = await fetch(restBase, {
      method: 'POST',
      headers: {
        ...headers,
        Prefer: 'return=representation'
      },
      body: JSON.stringify(shifts)
    });

    const insText = await insResp.text().catch(() => '');
    if (!insResp.ok) {
      return res.status(502).json({ ok: false, error: `Supabase insert failed (${insResp.status})`, detail: insText.slice(0, 2000) });
    }

    let inserted = null;
    try { inserted = JSON.parse(insText); } catch (_) { inserted = null; }
    const saved = Array.isArray(inserted) ? inserted.length : shifts.length;

    return res.json({ ok: true, saved });
  } catch (err) {
    console.error('Shifts proxy error:', err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// MIE proxy endpoint
app.post('/api/mie', async (req, res) => {
  try {
    const {
      method,
      soapUrl,
      username,
      password: passwordFromBody,
      clientKey,
      agentKey,
      source,
      loginSource,
      payload = {},
      aLogonXml: aLogonXmlOverride,
      aArgument: aArgumentOverride
    } = req.body || {};

    if (!method) return res.status(400).json({ ok: false, error: 'Missing method' });
    if (!soapUrl) return res.status(400).json({ ok: false, error: 'Missing soapUrl' });

    const secrets = loadLocalSecrets();
    const password = passwordFromBody || process.env.MIE_PASSWORD || secrets?.MIE_PASSWORD || secrets?.mie_password || null;
    const version = process.env.MIE_VERSION || secrets?.MIE_VERSION || secrets?.mie_version || '99.99.99';
    const resolvedLoginSource = loginSource || payload?.loginSource || process.env.MIE_LOGIN_SOURCE || secrets?.MIE_LOGIN_SOURCE || source || 'SMARTWEB';
    const requestSource = payload?.request?.source || payload?.source || source || 'STYLEPRO';
    if (!password) {
      return res.status(400).json({
        ok: false,
        error: 'Missing MIE password',
        hint: 'Set MIE_PASSWORD as an environment variable OR add secrets.local.json with { "MIE_PASSWORD": "..." }'
      });
    }

    // aLogonXml - MIE's EXACT format from their SOAP UI documentation
    const aLogonXml = aLogonXmlOverride || 
      `<xml><Token>` +
      `<UserName>${username ?? ''}</UserName>` +
      `<Password>${password}</Password>` +
      `<Source>${resolvedLoginSource}</Source>` +
      `<Version>${version}</Version>` +
      `</Token></xml>`;

    // aArgument - Use pre-built request if provided, otherwise build from payload
    let aArgument = aArgumentOverride;
    
    if (!aArgument && payload.request) {
      // Frontend has already built the complete Request XML structure - use it directly
      const requestPayload = payload.request;
      const itemList = Array.isArray(requestPayload.itemCollection) ? requestPayload.itemCollection : [];
      const resolvedVersion = requestPayload.version ?? version;
      
      aArgument = `<xml><Request>` +
        `<ClientKey>${requestPayload.clientKey ?? ''}</ClientKey>` +
        `<AgentClient>${requestPayload.agentClient ?? ''}</AgentClient>` +
        `<AgentKey>${requestPayload.agentKey ?? ''}</AgentKey>` +
        `<RemoteRequest>RS_${Date.now()}</RemoteRequest>` +
        `<OrderNumber></OrderNumber>` +
        `<RequestReason></RequestReason>` +
        `<Note></Note>` +
        `<FirstNames>${requestPayload.candidate?.firstNames ?? ''}</FirstNames>` +
        `<Surname>${requestPayload.candidate?.surname ?? ''}</Surname>` +
        `<MaidenName></MaidenName>` +
        `<IdNumber>${requestPayload.candidate?.idNumber ?? ''}</IdNumber>` +
        `<Passport></Passport>` +
        (requestPayload.candidate?.dateOfBirth ? `<DateOfBirth>${requestPayload.candidate.dateOfBirth}</DateOfBirth>` : '<DateOfBirth></DateOfBirth>') +
        `<ContactNumber>${requestPayload.candidate?.contact ?? ''}</ContactNumber>` +
        `<PersonEmail>${requestPayload.candidate?.email ?? ''}</PersonEmail>` +
        `<AlternateEmail></AlternateEmail>` +
        `<Version>${resolvedVersion}</Version>` +
        `<Source>${requestSource}</Source>` +
        `<EntityKind>P</EntityKind>` +
        `<RemoteCaptureDate>${new Date().toISOString()}</RemoteCaptureDate>` +
        `<RemoteSendDate>${new Date().toISOString()}</RemoteSendDate>` +
        `<RemoteGroup></RemoteGroup>` +
        `<PrerequisiteGroupList></PrerequisiteGroupList>` +
        `<PrerequisiteImageList></PrerequisiteImageList>` +
        `<ItemList>` +
        itemList.map(item => 
          `<Item>` +
          `<RemoteItemKey></RemoteItemKey>` +
          `<ItemTypeCode>${item.itemType ?? item.ItemType ?? ''}</ItemTypeCode>` +
          `<Indemnity>${item.indemnity === true || item.Indemnity === 'true' ? 'true' : 'false'}</Indemnity>` +
          `<ItemInputGroupList></ItemInputGroupList>` +
          `</Item>`
        ).join('') +
        `</ItemList>` +
        `</Request></xml>`;
    } else if (!aArgument) {
      // Fallback: build from raw payload fields (legacy/compatibility)
      const checkTypes = Array.isArray(payload.checkTypes) ? payload.checkTypes : [];
      const remoteKey = payload.remoteKey || `RS_${Date.now()}`;
      const currentDate = new Date().toISOString();
      
      aArgument = 
        `<xml><Request>` +
        `<ClientKey>${clientKey ?? ''}</ClientKey>` +
        `<AgentClient>${clientKey ?? ''}</AgentClient>` +
        `<AgentKey>${agentKey ?? ''}</AgentKey>` +
        `<RemoteRequest>${remoteKey}</RemoteRequest>` +
        `<OrderNumber></OrderNumber>` +
        `<RequestReason></RequestReason>` +
        `<Note></Note>` +
        `<FirstNames>${payload.firstName ?? ''}</FirstNames>` +
        `<Surname>${payload.lastName ?? ''}</Surname>` +
        `<MaidenName></MaidenName>` +
        `<IdNumber>${payload.idNumber ?? ''}</IdNumber>` +
        `<Passport></Passport>` +
        (payload.dateOfBirth ? `<DateOfBirth>${payload.dateOfBirth}</DateOfBirth>` : '<DateOfBirth></DateOfBirth>') +
        `<ContactNumber>${payload.phone ?? ''}</ContactNumber>` +
        `<PersonEmail>${payload.email ?? ''}</PersonEmail>` +
        `<AlternateEmail></AlternateEmail>` +
        `<Version>${payload.version ?? version}</Version>` +
        `<Source>${requestSource}</Source>` +
        `<EntityKind>P</EntityKind>` +
        `<RemoteCaptureDate>${currentDate}</RemoteCaptureDate>` +
        `<RemoteSendDate>${currentDate}</RemoteSendDate>` +
        `<RemoteGroup></RemoteGroup>` +
        `<PrerequisiteGroupList></PrerequisiteGroupList>` +
        `<PrerequisiteImageList></PrerequisiteImageList>` +
        `<ItemList>` +
        checkTypes.map(t => 
          `<Item>` +
          `<RemoteItemKey></RemoteItemKey>` +
          `<ItemTypeCode>${t.toUpperCase()}</ItemTypeCode>` +
          `<Indemnity>${payload.indemnityAcknowledged ? 'true' : 'false'}</Indemnity>` +
          `<ItemInputGroupList></ItemInputGroupList>` +
          `</Item>`
        ).join('') +
        `</ItemList>` +
        `</Request></xml>`;
    }

    const hasArgument = ['ksoputrequest', 'ksoputbranch', 'ksoputrequestredirect'].includes(String(method).toLowerCase());

    const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
      `<soap:Body>` +
      `<${method} xmlns="http://www.kroll.co.za/">` +
      `<aLogonXml>${cdataWrap(aLogonXml)}</aLogonXml>` +
      (hasArgument ? `<aArgument>${cdataWrap(aArgument)}</aArgument>` : '') +
      `</${method}>` +
      `</soap:Body>` +
      `</soap:Envelope>`;

    const soapAction = `http://www.kroll.co.za/${method}`;

    const resp = await fetch(soapUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': soapAction,
        'Accept': 'text/xml'
      },
      body: soapEnvelope
    });

    const respText = await resp.text();

    if (!resp.ok) {
      return res.status(502).json({
        ok: false,
        error: `MIE SOAP HTTP ${resp.status}`,
        soapAction,
        soapUrl,
        responseSnippet: respText.slice(0, 2000)
      });
    }

    const resultTag = `${method}Result`;
    const resultText = extractTagText(respText, resultTag);
    const requestKey = extractRequestKey(resultText);

    return res.json({
      ok: true,
      method,
      soapAction,
      requestKey: requestKey || null,
      reference: requestKey || null,
      result: resultText || null,
      rawSoapResponse: respText
    });
  } catch (err) {
    console.error('MIE proxy error:', err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

function getSmsCredentials() {
  const secrets = loadLocalSecrets();
  const clientId = process.env.SMS_CLIENT_ID || secrets?.SMS_CLIENT_ID || secrets?.sms_client_id || null;
  const clientSecret = process.env.SMS_CLIENT_SECRET || secrets?.SMS_CLIENT_SECRET || secrets?.sms_client_secret || null;
  return { clientId, clientSecret };
}

function formatSmsPortalNumber(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/\D/g, '');
  if (!cleaned) return '';
  // Normalize to 27XXXXXXXXX (no +)
  if (cleaned.startsWith('27')) return cleaned;
  if (cleaned.startsWith('0')) return `27${cleaned.slice(1)}`;
  if (cleaned.length === 9) return `27${cleaned}`;
  return cleaned;
}

async function forwardSms(req, res, smsPathOverride = null) {
  try {
    const { clientId, clientSecret } = getSmsCredentials();

    if (!clientId || !clientSecret) {
      return res.status(400).json({
        ok: false,
        error: 'Missing SMS credentials',
        hint: 'Set SMS_CLIENT_ID and SMS_CLIENT_SECRET as Render environment variables (or secrets.local.json for local dev).'
      });
    }

    // Extract the path after /api/sms
    const smsPath = smsPathOverride !== null
      ? smsPathOverride
      : req.url.replace('/api/sms', '');
    const smsUrl = `https://rest.smsportal.com${smsPath || ''}`;

    console.log('SMS Proxy Request:', {
      method: req.method,
      url: smsUrl,
      hasAuth: true
    });

    // Create base64 auth header
    const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    // Forward request to SMS Portal API with authentication
    const response = await fetch(smsUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authString}`
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined
    });

    const contentType = response.headers.get('content-type');
    
    // Handle JSON responses
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      return res.status(response.status).json(data);
    }
    
    // Handle text responses
    const text = await response.text();
    return res.status(response.status).send(text);

  } catch (err) {
    console.error('SMS proxy error:', err);
    return res.status(500).json({ 
      ok: false, 
      error: err?.message || String(err),
      stack: err?.stack 
    });
  }
}

// Friendly endpoints used by the front-end
app.post('/api/sms/send', async (req, res) => {
  try {
    const { message, recipients, options = {} } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, error: 'Message cannot be empty' });
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ success: false, error: 'No recipients specified' });
    }

    const messages = recipients.map(r => {
      const raw = (r && typeof r === 'object') ? (r.cellphone_number || r.phone || r.contact_number || r.mobile) : r;
      const destination = formatSmsPortalNumber(raw);
      return {
        content: String(message).trim(),
        destination,
        ...(options.scheduledFor ? { sendTime: options.scheduledFor } : {}),
        ...(options.reference ? { reference: options.reference } : {})
      };
    }).filter(m => m.destination);

    if (!messages.length) {
      return res.status(400).json({ success: false, error: 'No valid recipient numbers found' });
    }

    // SMS Portal bulk send
    const payload = {
      messages,
      testMode: !!options.testMode,
      ...(options.senderId ? { senderId: options.senderId } : {})
    };

    // Forward to the vendor endpoint
    // Note: SMSPortal uses /BulkMessages for bulk sends.
    const reqClone = {
      ...req,
      method: 'POST',
      body: payload
    };
    const forwardRes = await (async () => {
      // reuse the forwarding logic but override the path
      return forwardSms(reqClone, res, '/BulkMessages');
    })();
    return forwardRes;
  } catch (err) {
    console.error('SMS send error:', err);
    return res.status(500).json({ success: false, error: err?.message || String(err), type: 'proxy_error' });
  }
});

app.get('/api/sms/test', async (req, res) => {
  // Simple connectivity check used by sms-api.js
  return forwardSms(req, res, '/v1/Balance');
});

// Generic forwarders (supports /api/sms and /api/sms/*)
app.all('/api/sms', (req, res) => forwardSms(req, res));
app.all('/api/sms/*', (req, res) => forwardSms(req, res));

// MIE REST API Proxy - Forward all REST API calls to MIE (or mock)
app.all('/api/mie/:endpoint', async (req, res) => {
  try {
    const { endpoint } = req.params;
    const useMockMode = process.env.MIE_MOCK_MODE === 'true' || process.env.MIE_MOCK_MODE === '1';
    
    console.log(`[MIE REST Proxy] ${req.method} ${endpoint}${useMockMode ? ' [MOCK MODE]' : ''}`);
    
    // MOCK MODE - For testing without actual MIE connectivity
    if (useMockMode) {
      if (endpoint === 'authenticate') {
        return res.json({
          token: 'MOCK_TOKEN_' + Date.now(),
          expiresIn: 3600,
          status: 'success'
        });
      }
      
      if (endpoint === 'GetItemTypes') {
        return res.json({
          status: 'success',
          itemTypes: [
            { code: 'AFIS', name: 'Criminal Record (AFIS)' },
            { code: 'ERSTA', name: 'Employment Reference' },
            { code: 'CCCCR', name: 'Credit Check' },
            { code: 'ED', name: 'Education Verification' },
            { code: 'INTFPH', name: 'Physical Interview' }
          ]
        });
      }
      
      if (endpoint === 'SubmitRequest' || endpoint.includes('submit')) {
        return res.json({
          status: 'success',
          requestKey: 'REQ_' + Math.random().toString(36).substring(7).toUpperCase(),
          message: 'Request submitted successfully (MOCK)',
          itemCollection: req.body?.request?.itemCollection || []
        });
      }
      
      return res.json({ status: 'success', message: 'Mock response', endpoint });
    }
    
    // REAL MODE - Forward to actual MIE API
    const mieRestUrl = process.env.MIE_REST_URL || 'https://qa.mie.co.za/internal/services/epcvrest';
    const targetUrl = `${mieRestUrl}/${endpoint}`;
    
    console.log(`[MIE REST Proxy] Forwarding to: ${targetUrl}`);
    
    const options = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...Object.fromEntries(
          Object.entries(req.headers).filter(([k]) => 
            !['host', 'connection'].includes(k.toLowerCase())
          )
        )
      },
      timeout: 10000
    };
    
    if (req.body && (req.method === 'POST' || req.method === 'PUT')) {
      options.body = JSON.stringify(req.body);
    }
    
    const response = await fetch(targetUrl, options);
    const responseText = await response.text();
    
    // Set response headers
    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (!['content-encoding', 'transfer-encoding'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    
    res.send(responseText);
  } catch (error) {
    console.error('[MIE REST Proxy] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Listen on 0.0.0.0 for Render.com compatibility (safe for local too)
const host = '0.0.0.0';
app.listen(PORT, host, () => {
  console.log(`[rs-local-proxy] listening on http://${host}:${PORT}`);
  console.log(`[rs-local-proxy] health: http://${host}:${PORT}/health`);
  console.log(`[rs-local-proxy] Environment: ${process.env.RENDER ? 'Render.com' : 'Local'}`);
});
