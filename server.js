// server.js (ESM)
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { DOMParser } from 'xmldom';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// Derive allowed origins from env (comma-separated). If not set, echo the request origin.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : true; // true lets CORS echo back the request origin

app.use(express.json({ limit: '2mb' }));
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: false // no cookies needed; avoids wildcard+credentials CORS block
}));

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'rs-proxy-1',
    timestamp: new Date().toISOString(),
    capabilities: ['mie', 'sms']
  });
});

// ============================================
// MIE PROXY - /api/mie
// ============================================
app.post('/api/mie', async (req, res) => {
  try {
    const { method, soapUrl, username, clientKey, agentKey, source, loginSource, payload } = req.body;
    if (!method || !soapUrl) {
      return res.status(400).json({ error: 'method and soapUrl are required' });
    }

    let soapEnvelope;
    if (method === 'ksoLogin') {
      soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:kro="http://www.kroll.co.za/">
  <soap:Body>
    <kro:ksoLogin>
      <kro:username>${username}</kro:username>
      <kro:clientKey>${clientKey}</kro:clientKey>
      <kro:agentKey>${agentKey}</kro:agentKey>
      <kro:source>${source || 'STYLEPRO'}</kro:source>
      <kro:loginSource>${loginSource || 'SMARTWEB'}</kro:loginSource>
    </kro:ksoLogin>
  </soap:Body>
</soap:Envelope>`;
    } else if (method === 'ksoPutRequest') {
      soapEnvelope = buildKsoPutRequestEnvelope(username, clientKey, agentKey, source, loginSource, payload);
    } else {
      return res.status(400).json({ error: `Unsupported method: ${method}` });
    }

    const response = await fetch(soapUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': `http://www.kroll.co.za/${method}`
      },
      body: soapEnvelope
    });

    const xmlText = await response.text();
    // parse (not used further, but shows how to parse if needed)
    new DOMParser().parseFromString(xmlText, 'text/xml');

    res.status(response.status).json({
      ok: response.ok,
      status: response.status,
      result: xmlText
    });
  } catch (err) {
    console.error('❌ MIE Proxy error:', err);
    res.status(500).json({ error: 'MIE Proxy error: ' + err.message });
  }
});

// ============================================
// SMS PROXY - /api/sms
// ============================================
app.post('/api/sms', async (req, res) => {
  try {
    const { method, recipients, message, senderId, messageId } = req.body;
    if (!method) {
      return res.status(400).json({
        error: 'method is required',
        methods: ['send', 'getBalance', 'getDeliveryStatus']
      });
    }

    const clientId = process.env.SMS_PORTAL_CLIENT_ID;
    const clientSecret = process.env.SMS_PORTAL_CLIENT_SECRET;
    const baseUrl = process.env.SMS_PORTAL_BASE_URL || 'https://rest.smsportal.com';
    const sender = senderId || process.env.SMS_PORTAL_SENDER_ID || 'RetailSolutions';

    if (!clientId || !clientSecret) {
      console.error('❌ SMS credentials missing');
      return res.status(500).json({
        error: 'SMS Portal credentials not configured',
        hint: 'Add SMS_PORTAL_CLIENT_ID and SMS_PORTAL_CLIENT_SECRET in Render environment'
      });
    }

    const auth = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;

    // SEND
    if (method === 'send') {
      if (!recipients || !message) {
        return res.status(400).json({ error: 'recipients and message are required' });
      }
      const normalizedRecipients = Array.isArray(recipients) ? recipients : [recipients];
      const messages = normalizedRecipients.map((r) => {
        const raw = (r && typeof r === 'object')
          ? (r.cellphone_number || r.phone || r.contact_number || r.mobile || r.number || r.destination)
          : r;
        const digits = String(raw || '').replace(/[^0-9]/g, '');
        const destination = digits.startsWith('0') ? `27${digits.slice(1)}` : digits;
        return {
          content: String(message),
          destination
        };
      }).filter(m => m.destination);

      if (!messages.length) {
        return res.status(400).json({ error: 'No valid recipients after normalization' });
      }

      const response = await fetch(`${baseUrl}/v1/BulkMessages`, {
        method: 'POST',
        headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          senderId: sender
        })
      });
      const data = await response.json();
      if (!response.ok) {
        console.error('❌ SMS Portal API Error:', response.status, data);
        return res.status(response.status).json({ error: 'Failed to send SMS', details: data });
      }
      return res.json({
        success: true,
        messageId: data.messageId || data.id || data.results?.[0]?.messageId,
        batchId: data.batchId,
        recipientCount: messages.length,
        data
      });
    }

    // BALANCE
    if (method === 'getBalance') {
      const response = await fetch(`${baseUrl}/v1/Balance`, {
        method: 'GET',
        headers: { 'Authorization': auth, 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      if (!response.ok) {
        console.error('❌ Balance Error:', response.status, data);
        return res.status(response.status).json({ error: 'Failed to get balance', details: data });
      }
      const balance = data.balance ?? data.credits ?? data.available ?? 0;
      return res.json({ success: true, balance, currency: 'ZAR', data });
    }

    // DELIVERY STATUS
    if (method === 'getDeliveryStatus') {
      if (!messageId) return res.status(400).json({ error: 'messageId is required' });
      const response = await fetch(`${baseUrl}/v1/messages/${messageId}`, {
        method: 'GET',
        headers: { 'Authorization': auth, 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      if (!response.ok) {
        console.error('❌ Status Error:', response.status, data);
        return res.status(response.status).json({ error: 'Failed to get status', details: data });
      }
      return res.json({
        success: true,
        messageId,
        status: data.status,
        deliveryStatus: data.deliveryStatus,
        data
      });
    }

    return res.status(400).json({
      error: `Unknown method: ${method}`,
      supportedMethods: ['send', 'getBalance', 'getDeliveryStatus']
    });
  } catch (err) {
    console.error('❌ SMS Proxy error:', err.message);
    res.status(500).json({ error: 'SMS Proxy error: ' + err.message });
  }
});

// ============================================
// SMS DELIVERY CALLBACK
// ============================================
app.post('/api/sms-callback', (req, res) => {
  try {
    const { messageId, status, deliveryStatus, recipient } = req.body;
    console.log('📞 SMS Callback received:', { messageId, status, deliveryStatus, recipient });
    res.json({ status: 'received', messageId, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('❌ Callback error:', err.message);
    res.status(500).json({ error: 'Callback error: ' + err.message });
  }
});

// ============================================
// HELPER
// ============================================
function buildKsoPutRequestEnvelope(username, clientKey, agentKey, source, loginSource, payload) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:kro="http://www.kroll.co.za/">
  <soap:Body>
    <kro:ksoPutRequest>
      <kro:username>${username}</kro:username>
      <kro:clientKey>${clientKey}</kro:clientKey>
      <kro:agentKey>${agentKey}</kro:agentKey>
      <kro:source>${source || 'STYLEPRO'}</kro:source>
      <kro:loginSource>${loginSource || 'SMARTWEB'}</kro:loginSource>
      <kro:payload>${JSON.stringify(payload || {})}</kro:payload>
    </kro:ksoPutRequest>
  </soap:Body>
</soap:Envelope>`;
}

// ============================================
// START SERVER
// ============================================
const host = '0.0.0.0';
app.listen(PORT, host, () => {
  console.log('\n========================================');
  console.log('🚀 RS Proxy Server Started');
  console.log('========================================');
  console.log(`📍 Port: ${PORT}`);
  console.log(`📍 Health: http://${host}:${PORT}/health`);
  console.log(`📍 MIE API: http://${host}:${PORT}/api/mie`);
  console.log(`📍 SMS API: http://${host}:${PORT}/api/sms`);
  console.log(`📍 SMS Callback: http://${host}:${PORT}/api/sms-callback`);
  console.log('========================================\n');

  if (!process.env.SMS_PORTAL_CLIENT_ID || !process.env.SMS_PORTAL_CLIENT_SECRET) {
    console.warn('⚠️  SMS credentials not set - SMS operations will fail');
  }
});
