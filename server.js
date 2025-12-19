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
      SMS_CLIENT_SECRET: !!process.env.SMS_CLIENT_SECRET
    }
  });
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
      payload = {},
      aLogonXml: aLogonXmlOverride,
      aArgument: aArgumentOverride
    } = req.body || {};

    if (!method) return res.status(400).json({ ok: false, error: 'Missing method' });
    if (!soapUrl) return res.status(400).json({ ok: false, error: 'Missing soapUrl' });

    const secrets = loadLocalSecrets();
    const password = passwordFromBody || process.env.MIE_PASSWORD || secrets?.MIE_PASSWORD || secrets?.mie_password || null;
    if (!password) {
      return res.status(400).json({
        ok: false,
        error: 'Missing MIE password',
        hint: 'Set MIE_PASSWORD as an environment variable OR add secrets.local.json with { "MIE_PASSWORD": "..." }'
      });
    }

    const aLogonXml = aLogonXmlOverride || `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<Logon>` +
      `<ClientKey>${clientKey ?? ''}</ClientKey>` +
      `<AgentKey>${agentKey ?? ''}</AgentKey>` +
      `<Username>${username ?? ''}</Username>` +
      `<Password>${password}</Password>` +
      `<Source>${source ?? ''}</Source>` +
      `</Logon>`;

    const checkTypes = Array.isArray(payload.checkTypes) ? payload.checkTypes : [];
    const aArgument = aArgumentOverride || `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<Request>` +
      `<IdNumber>${payload.idNumber ?? ''}</IdNumber>` +
      `<FirstName>${payload.firstName ?? ''}</FirstName>` +
      `<LastName>${payload.lastName ?? ''}</LastName>` +
      (payload.dateOfBirth ? `<DateOfBirth>${payload.dateOfBirth}</DateOfBirth>` : '') +
      (payload.email ? `<Email>${payload.email}</Email>` : '') +
      (payload.phone ? `<Phone>${payload.phone}</Phone>` : '') +
      `<CheckTypes>` +
      checkTypes.map(t => `<CheckType>${t}</CheckType>`).join('') +
      `</CheckTypes>` +
      `<Source>${payload.source ?? source ?? ''}</Source>` +
      `</Request>`;

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

// SMS proxy endpoint (optional)
app.post('/api/sms', async (req, res) => {
  try {
    const secrets = loadLocalSecrets();
    const clientId = process.env.SMS_CLIENT_ID || secrets?.SMS_CLIENT_ID;
    const clientSecret = process.env.SMS_CLIENT_SECRET || secrets?.SMS_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(400).json({
        ok: false,
        error: 'Missing SMS credentials'
      });
    }

    // Forward SMS request to SMS Portal API
    const response = await fetch('https://rest.smsportal.com/v1/Authentication', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        clientId,
        clientSecret,
        ...req.body
      })
    });

    const data = await response.json();
    return res.json(data);

  } catch (err) {
    console.error('SMS proxy error:', err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Listen on 0.0.0.0 for Render.com compatibility
const host = process.env.RENDER ? '0.0.0.0' : '127.0.0.1';
app.listen(PORT, host, () => {
  console.log(`[rs-local-proxy] listening on http://${host}:${PORT}`);
  console.log(`[rs-local-proxy] health: http://${host}:${PORT}/health`);
  console.log(`[rs-local-proxy] Environment: ${process.env.RENDER ? 'Render.com' : 'Local'}`);
});
