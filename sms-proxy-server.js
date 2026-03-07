/**
 * SMS Portal API Proxy Server
 * Handles CORS issues and securely proxies requests to SMS Portal
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = parseInt(process.env.SMS_PROXY_PORT || '3001', 10); // Different from static server
// Simple root for sanity check
app.get('/', (req, res) => {
    res.type('text/plain').send('SMS Proxy OK');
});

// SMS Portal API Configuration
const SMS_CONFIG = {
    CLIENT_ID: '05764da0-ebbc-414f-a190-b405ec876654',
    CLIENT_SECRET: 'SG4CbGLy6dphO5NEWfZO3ny0xWMv3dmm',
    BASE_URL: 'https://rest.smsportal.com'
};

// Generate Basic Auth credentials
const credentials = Buffer.from(`${SMS_CONFIG.CLIENT_ID}:${SMS_CONFIG.CLIENT_SECRET}`).toString('base64');

// Middleware
// CORS Configuration - Allow all origins (secure alternative: whitelist specific domains)
// For production, consider restricting to your actual domain:
// const ALLOWED_ORIGINS = ['https://your-domain.com', 'https://www.your-domain.com'];
app.use(cors({
    origin: function(origin, callback) {
        // Allow non-browser requests (like curl) with no origin
        if (!origin) return callback(null, true);
        // For now, allow all origins (can be restricted to specific domains in production)
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    optionsSuccessStatus: 200
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'SMS Portal Proxy',
        version: '1.0.0'
    });
});

// Unified API endpoint - routes based on method field in body
// Supports both /api/sms and /api/sms/* patterns
app.post('/api/sms', async (req, res) => {
    const { method } = req.body;
    
    switch (method) {
        case 'send':
            return handleSendSMS(req, res);
        case 'getBalance':
            return handleGetBalance(req, res);
        case 'getHistory':
            return handleGetHistory(req, res);
        case 'test':
            return handleTestConnection(req, res);
        default:
            return res.status(400).json({
                success: false,
                error: `Unknown method: ${method}`,
                supported_methods: ['send', 'getBalance', 'getHistory', 'test']
            });
    }
});

// Alternative: Support specific endpoint pattern for direct routing
app.post('/api/sms/send', handleSendSMS);
app.post('/api/sms/balance', handleGetBalance);
app.post('/api/sms/history', handleGetHistory);
app.post('/api/sms/test', handleTestConnection);

// GET endpoints for convenience
app.get('/api/sms/balance', handleGetBalance);
app.get('/api/sms/history', handleGetHistory);
app.get('/api/sms/test', handleTestConnection);

// SMS Balance handler
async function handleGetBalance(req, res) {
    try {
        console.log('🔍 Fetching SMS balance from SMS Portal...');
        
        const response = await fetch(`${SMS_CONFIG.BASE_URL}/balance`, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Accept': 'application/json',
                'User-Agent': 'RetailSolutions-SMSProxy/1.0'
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            console.log('✅ Balance retrieved successfully');
            res.json({
                success: true,
                balance: data.balance || data.credits || 0,
                currency: data.currency || 'Credits',
                data: data
            });
        } else {
            console.error('❌ Balance fetch failed:', data);
            res.status(response.status).json({
                success: false,
                error: data.error?.message || 'Failed to fetch balance',
                data: data
            });
        }
    } catch (error) {
        console.error('🔥 Balance API Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            type: 'proxy_error'
        });
    }
}

// SMS History handler
async function handleGetHistory(req, res) {
    try {
        console.log('🔍 Fetching SMS history from SMS Portal...');
        
        // Build query parameters from URL or body
        const params = new URLSearchParams();
        const query = req.query || req.body || {};
        
        if (query.limit) params.append('limit', query.limit);
        if (query.offset) params.append('offset', query.offset);
        if (query.fromDate) params.append('fromDate', query.fromDate);
        if (query.toDate) params.append('toDate', query.toDate);
        
        const url = `${SMS_CONFIG.BASE_URL}/Messages${params.toString() ? `?${params.toString()}` : ''}`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Accept': 'application/json',
                'User-Agent': 'RetailSolutions-SMSProxy/1.0'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ History retrieved successfully');
            
            res.json({
                success: true,
                messages: data.messages || data.results || [],
                totalCount: data.totalCount || data.messages?.length || 0,
                data: data
            });
        } else {
            const errorData = await response.json().catch(() => ({}));
            console.warn('⚠️ History fetch failed:', errorData);
            
            // Return empty results for history instead of error
            res.json({
                success: true,
                messages: [],
                totalCount: 0,
                data: { error: errorData }
            });
        }
    } catch (error) {
        console.warn('⚠️ History API Error:', error);
        
        // Return empty results for history instead of error
        res.json({
            success: true,
            messages: [],
            totalCount: 0,
            data: { error: error.message }
        });
    }
}

// SMS Send handler
async function handleSendSMS(req, res) {
    try {
        console.log('📤 Sending SMS via SMS Portal...');
        
        const { message, recipients, options = {}, senderId } = req.body;
        
        if (!message || !message.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Message cannot be empty'
            });
        }
        
        if (!recipients || recipients.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No recipients specified'
            });
        }
        
        // Format recipients for SMS Portal API
        const messages = recipients.map(recipient => ({
            content: message.trim(),
            destination: formatPhoneNumber(recipient.cellphone_number || recipient.phone || recipient),
            ...(options.scheduledFor && { sendTime: options.scheduledFor }),
            ...(options.reference && { reference: options.reference })
        }));
        
        const requestBody = {
            messages: messages,
            testMode: options.testMode || false,
            ...(senderId && { senderId: senderId }),
            ...(!senderId && { senderId: 'RetailSolutions' })
        };
        
        console.log(`📤 Sending ${messages.length} messages...`);
        
        const response = await fetch(`${SMS_CONFIG.BASE_URL}/BulkMessages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${credentials}`,
                'User-Agent': 'RetailSolutions-SMSProxy/1.0'
            },
            body: JSON.stringify(requestBody)
        });
        
        const responseData = await response.json();
        
        if (response.ok) {
            console.log('✅ SMS sent successfully');
            res.json({
                success: true,
                messageId: responseData.results?.[0]?.messageId,
                results: responseData.results,
                cost: responseData.cost,
                recipientCount: messages.length,
                data: responseData
            });
        } else {
            console.error('❌ SMS send failed:', responseData);
            res.status(response.status).json({
                success: false,
                error: responseData.error?.message || 'SMS send failed',
                data: responseData
            });
        }
        
    } catch (error) {
        console.error('🔥 SMS send error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            type: 'proxy_error'
        });
    }
}

// Test connection handler
async function handleTestConnection(req, res) {
    try {
        console.log('🧪 Testing SMS Portal connection...');
        
        const response = await fetch(`${SMS_CONFIG.BASE_URL}/balance`, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Accept': 'application/json',
                'User-Agent': 'RetailSolutions-SMSProxy/1.0'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Connection test successful');
            res.json({
                success: true,
                status: 'connected',
                message: 'SMS Portal API connection successful',
                balance: data.balance || data.credits || 0,
                data: data
            });
        } else {
            const errorData = await response.json().catch(() => ({}));
            console.error('❌ Connection test failed:', errorData);
            res.status(response.status).json({
                success: false,
                status: 'failed',
                error: errorData.error?.message || `HTTP ${response.status}`,
                data: errorData
            });
        }
        
    } catch (error) {
        console.error('🔥 Connection test error:', error);
        res.status(500).json({
            success: false,
            status: 'error',
            error: error.message,
            type: 'proxy_error'
        });
    }
}

// Format phone number for SMS Portal (South African format)
function formatPhoneNumber(phone) {
    if (!phone) return '';
    
    // Remove all non-digit characters
    let cleaned = phone.toString().replace(/\D/g, '');
    
    // Handle South African numbers
    if (cleaned.startsWith('27')) {
        // Already has country code
        return `+${cleaned}`;
    } else if (cleaned.startsWith('0')) {
        // Remove leading 0 and add SA country code
        return `+27${cleaned.substring(1)}`;
    } else if (cleaned.length === 9) {
        // 9 digits without leading 0, add SA country code
        return `+27${cleaned}`;
    }
    
    // Default: assume it needs SA country code if no country code present
    if (cleaned.length >= 9 && !cleaned.startsWith('+')) {
        return `+27${cleaned}`;
    }
    
    return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('🔥 Proxy Server Error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal proxy server error',
        type: 'proxy_error'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        available_endpoints: [
            'GET /health',
            'GET /api/sms/balance',
            'GET /api/sms/history',
            'POST /api/sms/send',
            'GET /api/sms/test'
        ]
    });
});

// Start server
app.listen(PORT, '127.0.0.1', () => {
    console.log('🚀 ===============================================');
    console.log('🚀  SMS Portal Proxy Server Started');
    console.log('🚀 ===============================================');
    console.log(`🚀  Server running on: http://localhost:${PORT}`);
    console.log('🚀  Health check: http://localhost:3001/health');
    console.log('🚀  Test connection: http://localhost:3001/api/sms/test');
    console.log('🚀 ===============================================');
    console.log('✅  Ready to handle SMS Portal API requests!');
    console.log('🔧  CORS enabled for local development');
    console.log('📱  SMS Portal integration active');
    console.log('🚀 ===============================================');
});

module.exports = app;
