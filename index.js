const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 10000;

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.json({ limit: '2mb' }));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
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
// MIE PROXY - /api/mie (EXISTING - DO NOT MODIFY)
// ============================================
app.post('/api/mie', async (req, res) => {
  try {
    const { method, soapUrl, username, clientKey, agentKey, source, loginSource, payload } = req.body;

    if (!method || !soapUrl) {
      return res.status(400).json({ error: 'method and soapUrl are required' });
    }

    // Build SOAP envelope based on method
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
      // Handle ksoPutRequest - more complex payload
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

    // Parse XML response
    const parser = new (require('xmldom').DOMParser)();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

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
// SMS PROXY - /api/sms (NEW)
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

    // Get SMS credentials from Render env vars
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

    // ========== SEND SMS ==========
    if (method === 'send') {
      if (!recipients || !message) {
        return res.status(400).json({ error: 'recipients and message are required' });
      }

      try {
        console.log(`📤 Sending SMS to ${Array.isArray(recipients) ? recipients.length : 1} recipient(s)`);

        const response = await fetch(`${baseUrl}/v1/sms/send`, {
          method: 'POST',
          headers: {
            'Authorization': auth,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            recipients: Array.isArray(recipients) ? recipients : [recipients],
            body: message,
            senderId: sender
          })
        });

        const data = await response.json();

        if (!response.ok) {
          console.error('❌ SMS Portal API Error:', response.status, data);
          return res.status(response.status).json({ error: 'Failed to send SMS', details: data });
        }

        console.log('✅ SMS sent:', data);
        return res.json({ 
          success: true, 
          messageId: data.messageId || data.id,
          batchId: data.batchId,
          recipientCount: Array.isArray(recipients) ? recipients.length : 1,
          data: data
        });

      } catch (err) {
        console.error('❌ SMS send error:', err.message);
        return res.status(500).json({ error: 'Failed to send SMS', details: err.message });
      }
    }

    // ========== GET BALANCE ==========
    else if (method === 'getBalance') {
      try {
        console.log('📊 Fetching SMS balance...');

        const response = await fetch(`${baseUrl}/v1/account/balance`, {
          method: 'GET',
          headers: {
            'Authorization': auth,
            'Content-Type': 'application/json'
          }
        });

        const data = await response.json();

        if (!response.ok) {
          console.error('❌ Balance Error:', response.status, data);
          return res.status(response.status).json({ error: 'Failed to get balance', details: data });
        }

        console.log('✅ Balance:', data.balance);
        return res.json({ 
          success: true, 
          balance: data.balance,
          currency: 'ZAR',
          data: data
        });

      } catch (err) {
        console.error('❌ Balance error:', err.message);
        return res.status(500).json({ error: 'Failed to get balance', details: err.message });
      }
    }

    // ========== GET DELIVERY STATUS ==========
    else if (method === 'getDeliveryStatus') {
      if (!messageId) {
        return res.status(400).json({ error: 'messageId is required' });
      }

      try {
        console.log(`🔍 Fetching status for message: ${messageId}`);

        const response = await fetch(`${baseUrl}/v1/messages/${messageId}`, {
          method: 'GET',
          headers: {
            'Authorization': auth,
            'Content-Type': 'application/json'
          }
        });

        const data = await response.json();

        if (!response.ok) {
          console.error('❌ Status Error:', response.status, data);
          return res.status(response.status).json({ error: 'Failed to get status', details: data });
        }

        console.log('✅ Status:', data.status);
        return res.json({ 
          success: true, 
          messageId: messageId,
          status: data.status,
          deliveryStatus: data.deliveryStatus,
          data: data
        });

      } catch (err) {
        console.error('❌ Status error:', err.message);
        return res.status(500).json({ error: 'Failed to get status', details: err.message });
      }
    }

    else {
      return res.status(400).json({ 
        error: `Unknown method: ${method}`,
        supportedMethods: ['send', 'getBalance', 'getDeliveryStatus']
      });
    }

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
    const { messageId, status, deliveryStatus, reason, recipient } = req.body;

    console.log('📞 SMS Callback received:', {
      messageId,
      status,
      deliveryStatus,
      recipient
    });

    res.json({ status: 'received', messageId: messageId, timestamp: new Date().toISOString() });

  } catch (err) {
    console.error('❌ Callback error:', err.message);
    res.status(500).json({ error: 'Callback error: ' + err.message });
  }
});

// ============================================
// HELPER: Build ksoPutRequest SOAP Envelope
// ============================================
function buildKsoPutRequestEnvelope(username, clientKey, agentKey, source, loginSource, payload) {
  // This is a simplified version; adjust based on your MIE_API_IMPLEMENTATION_GUIDE
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
app.listen(PORT, () => {
  console.log('\n========================================');
  console.log('🚀 RS Proxy Server Started');
  console.log('========================================');
  console.log(`📍 Port: ${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/health`);
  console.log(`📍 MIE API: http://localhost:${PORT}/api/mie`);
  console.log(`📍 SMS API: http://localhost:${PORT}/api/sms`);
  console.log(`📍 SMS Callback: http://localhost:${PORT}/api/sms-callback`);
  console.log('========================================\n');

  if (!process.env.SMS_PORTAL_CLIENT_ID || !process.env.SMS_PORTAL_CLIENT_SECRET) {
    console.warn('⚠️  SMS credentials not set - SMS operations will fail');
  }
});
