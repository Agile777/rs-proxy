const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// SMS Portal credentials from environment variables
const SMS_CLIENT_ID = process.env.SMS_CLIENT_ID || '041c9a63-6173-4122-9695-16f71a621482';
const SMS_CLIENT_SECRET = process.env.SMS_CLIENT_SECRET || 'kiw9iKn9UUoi+wMG9o9JGBzHbEMEW0WE';

// MIE credentials from environment variables
const MIE_USERNAME = process.env.MIE_USERNAME;
const MIE_PASSWORD = process.env.MIE_PASSWORD;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    time: new Date().toISOString(),
    envVariablesDetected: {
      SMS_CLIENT_SECRET: !!SMS_CLIENT_SECRET,
      MIE_USERNAME: !!MIE_USERNAME,
      MIE_PASSWORD: !!MIE_PASSWORD
    },
    cwd: process.cwd()
  });
});

// SMS Portal API proxy - Wildcard route to handle ALL SMS endpoints
app.all('/api/sms/*', async (req, res) => {
  try {
    // Extract the SMS API path (everything after /api/sms/)
    const smsPath = req.params[0] || req.path.replace('/api/sms/', '');
    const targetUrl = `https://rest.smsportal.com/${smsPath}`;

    console.log('📡 SMS Proxy Request:', {
      method: req.method,
      originalPath: req.path,
      smsPath: smsPath,
      targetUrl: targetUrl,
      hasBody: !!req.body,
      bodySize: req.body ? JSON.stringify(req.body).length : 0
    });

    // Create Basic Auth header
    const authString = Buffer.from(`${SMS_CLIENT_ID}:${SMS_CLIENT_SECRET}`).toString('base64');
    
    const headers = {
      'Authorization': `Basic ${authString}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // Make request to SMS Portal API
    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: headers,
      data: req.body,
      validateStatus: () => true // Accept all status codes
    });

    console.log('✅ SMS Proxy Response:', {
      status: response.status,
      statusText: response.statusText,
      hasData: !!response.data
    });

    // Return the response
    res.status(response.status).json(response.data);

  } catch (error) {
    console.error('❌ SMS Proxy Error:', {
      message: error.message,
      code: error.code,
      path: req.path
    });

    res.status(500).json({
      error: 'Proxy request failed',
      message: error.message,
      details: error.response?.data || null
    });
  }
});

// MIE API proxy endpoint
app.post('/api/mie/login', async (req, res) => {
  try {
    console.log('🔐 MIE Login request received');

    if (!MIE_USERNAME || !MIE_PASSWORD) {
      console.error('❌ MIE credentials not configured');
      return res.status(500).json({
        error: 'MIE credentials not configured on server'
      });
    }

    const response = await axios.post(
      'https://secure.verified.africa/api/token/login',
      {
        username: MIE_USERNAME,
        password: MIE_PASSWORD
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        validateStatus: () => true
      }
    );

    console.log('✅ MIE Login response:', {
      status: response.status,
      hasToken: !!response.data?.access
    });

    res.status(response.status).json(response.data);

  } catch (error) {
    console.error('❌ MIE Login error:', error.message);
    res.status(500).json({
      error: 'MIE login failed',
      message: error.message
    });
  }
});

// MIE API proxy for authenticated requests
app.all('/api/mie/*', async (req, res) => {
  try {
    const miePath = req.params[0];
    const targetUrl = `https://secure.verified.africa/api/${miePath}`;

    console.log('📡 MIE Proxy Request:', {
      method: req.method,
      path: miePath,
      targetUrl: targetUrl
    });

    const headers = {
      'Content-Type': 'application/json',
      ...req.headers
    };

    delete headers.host;
    delete headers['content-length'];

    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: headers,
      data: req.body,
      validateStatus: () => true
    });

    console.log('✅ MIE Proxy Response:', {
      status: response.status
    });

    res.status(response.status).json(response.data);

  } catch (error) {
    console.error('❌ MIE Proxy Error:', error.message);
    res.status(500).json({
      error: 'Proxy request failed',
      message: error.message
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'RS Proxy Server',
    version: '2.0',
    endpoints: {
      health: '/health',
      sms: '/api/sms/*',
      mie: '/api/mie/*'
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 RS Proxy Server running on port ${PORT}`);
  console.log(`📡 SMS Portal proxy: /api/sms/*`);
  console.log(`📡 MIE proxy: /api/mie/*`);
  console.log(`✅ Health check: /health\n`);
});
