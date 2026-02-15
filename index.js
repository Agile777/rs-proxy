const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

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
// INITIALIZE SUPABASE (Optional - for logging)
// ============================================
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  console.log('✅ Supabase initialized for SMS logging');
} else {
  console.warn('⚠️  Supabase not configured - SMS callbacks won\'t be logged');
}

// ============================================
// HEALTH CHECK (for Render monitoring)
// ============================================
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    service: 'sms-proxy',
    timestamp: new Date().toISOString()
  });
});

async function readJsonSafe(response) {
  const text = await response.text();
  if (!text) return { data: null, raw: '' };
  try {
    return { data: JSON.parse(text), raw: text };
  } catch (_) {
    return { data: null, raw: text };
  }
}

// ============================================
// SMS PROXY ENDPOINT - /api/sms
// ============================================
app.post('/api/sms', async (req, res) => {
  try {
    const { method, recipients, message, senderId } = req.body;

    // Validate required fields
    if (!method) {
      return res.status(400).json({ 
        error: 'method is required',
        methods: ['send', 'getBalance', 'getDeliveryStatus']
      });
    }

    // Get credentials from environment variables
    const clientId = process.env.SMS_PORTAL_CLIENT_ID;
    const clientSecret = process.env.SMS_PORTAL_CLIENT_SECRET;
    const baseUrl = process.env.SMS_PORTAL_BASE_URL || 'https://rest.smsportal.com';
    const sender = senderId || process.env.SMS_PORTAL_SENDER_ID || 'RetailSolutions';

    // Validate credentials exist
    if (!clientId || !clientSecret) {
      console.error('❌ SMS credentials missing from Render environment');
      return res.status(500).json({ 
        error: 'SMS Portal credentials not configured on Render',
        hint: 'Add SMS_PORTAL_CLIENT_ID and SMS_PORTAL_CLIENT_SECRET in Render dashboard'
      });
    }

    // ========== SEND SMS ==========
    if (method === 'send') {
      if (!recipients || !message) {
        return res.status(400).json({ 
          error: 'recipients and message are required for send method' 
        });
      }

      try {
        console.log(`📤 Sending SMS to ${Array.isArray(recipients) ? recipients.length : 1} recipient(s)`);

        const response = await fetch(`${baseUrl}/v1/sms/send`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            recipients: Array.isArray(recipients) ? recipients : [recipients],
            body: message,
            senderId: sender
          })
        });

        const { data, raw } = await readJsonSafe(response);

        if (!response.ok) {
          console.error('❌ SMS Portal API Error:', response.status, data);
          return res.status(response.status).json({ 
            error: 'Failed to send SMS', 
            details: data || raw || null
          });
        }

        if (!data) {
          return res.status(502).json({
            error: 'Invalid JSON response from SMS Portal',
            details: raw || null
          });
        }

        console.log('✅ SMS sent successfully:', data);
        return res.status(200).json({ 
          success: true, 
          messageId: data.messageId || data.id,
          batchId: data.batchId,
          recipientCount: Array.isArray(recipients) ? recipients.length : 1,
          data: data
        });

      } catch (err) {
        console.error('❌ SMS send error:', err.message);
        return res.status(500).json({ 
          error: 'Failed to send SMS',
          details: err.message 
        });
      }
    }

    // ========== GET BALANCE ==========
    else if (method === 'getBalance') {
      try {
        console.log('📊 Fetching SMS balance...');

        const response = await fetch(`${baseUrl}/v1/account/balance`, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/json'
          }
        });

        const { data, raw } = await readJsonSafe(response);

        if (!response.ok) {
          console.error('❌ Balance Error:', response.status, data);
          return res.status(response.status).json({ 
            error: 'Failed to get balance', 
            details: data || raw || null
          });
        }

        if (!data) {
          return res.status(502).json({
            error: 'Invalid JSON response from SMS Portal',
            details: raw || null
          });
        }

        console.log('✅ Balance retrieved:', data.balance);
        return res.status(200).json({ 
          success: true, 
          balance: data.balance,
          currency: 'ZAR',
          data: data
        });

      } catch (err) {
        console.error('❌ Balance error:', err.message);
        return res.status(500).json({ 
          error: 'Failed to get balance',
          details: err.message 
        });
      }
    }

    // ========== GET DELIVERY STATUS ==========
    else if (method === 'getDeliveryStatus') {
      const { messageId } = req.body;
      if (!messageId) {
        return res.status(400).json({ 
          error: 'messageId is required for getDeliveryStatus' 
        });
      }

      try {
        console.log(`🔍 Fetching status for message: ${messageId}`);

        const response = await fetch(`${baseUrl}/v1/messages/${messageId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/json'
          }
        });

        const { data, raw } = await readJsonSafe(response);

        if (!response.ok) {
          console.error('❌ Status Error:', response.status, data);
          return res.status(response.status).json({ 
            error: 'Failed to get message status', 
            details: data || raw || null
          });
        }

        if (!data) {
          return res.status(502).json({
            error: 'Invalid JSON response from SMS Portal',
            details: raw || null
          });
        }

        console.log('✅ Message status retrieved:', data.status);
        return res.status(200).json({ 
          success: true, 
          messageId: messageId,
          status: data.status,
          deliveryStatus: data.deliveryStatus,
          data: data
        });

      } catch (err) {
        console.error('❌ Status error:', err.message);
        return res.status(500).json({ 
          error: 'Failed to get message status',
          details: err.message 
        });
      }
    }

    // Unknown method
    else {
      return res.status(400).json({ 
        error: `Unknown method: ${method}`,
        supportedMethods: ['send', 'getBalance', 'getDeliveryStatus']
      });
    }

  } catch (err) {
    console.error('❌ Unexpected proxy error:', err.message);
    res.status(500).json({ 
      error: 'Proxy error: ' + err.message 
    });
  }
});

// ============================================
// SMS DELIVERY CALLBACK (Optional - receives MIE webhooks)
// ============================================
app.post('/api/sms-callback', async (req, res) => {
  try {
    const { messageId, status, deliveryStatus, reason, recipient, timestamp } = req.body;

    console.log('📞 SMS Callback received:', {
      messageId,
      status,
      deliveryStatus,
      recipient
    });

    // Optional: Log callback to Supabase for audit/history
    if (supabase) {
      try {
        const { error: logError } = await supabase
          .from('sms_delivery_log')
          .insert({
            message_id: messageId,
            recipient: recipient || null,
            status: status || deliveryStatus,
            reason: reason || null,
            received_at: new Date().toISOString()
          });

        if (logError) {
          console.warn('⚠️  Failed to log SMS callback to Supabase:', logError.message);
        } else {
          console.log('✅ Callback logged to Supabase');
        }
      } catch (logErr) {
        console.warn('⚠️  Supabase logging error:', logErr.message);
      }
    }

    // Always return 200 so SMS Portal doesn't retry
    res.status(200).json({ 
      status: 'received',
      messageId: messageId,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Callback processing error:', err.message);
    res.status(500).json({ 
      error: 'Callback error: ' + err.message 
    });
  }
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log('\n========================================');
  console.log('🚀 SMS Proxy Server Started');
  console.log('========================================');
  console.log(`📍 Port: ${PORT}`);
  console.log(`📍 Health Check: http://localhost:${PORT}/health`);
  console.log(`📍 SMS API: http://localhost:${PORT}/api/sms`);
  console.log(`📍 Callback: http://localhost:${PORT}/api/sms-callback`);
  console.log('========================================\n');
  
  // Verify critical env vars
  if (!process.env.SMS_PORTAL_CLIENT_ID || !process.env.SMS_PORTAL_CLIENT_SECRET) {
    console.warn('⚠️  WARNING: SMS_PORTAL_CLIENT_ID or SMS_PORTAL_CLIENT_SECRET not set!');
    console.warn('   SMS operations will fail until these are added to Render environment.\n');
  }
});
