/**
 * SMS Portal API Handler (with Proxy)
 * Uses local proxy server to handle CORS and authentication
 */

class SMSAPIHandler {
    constructor() {
        this.config = window.RETAIL_CONFIG?.SMS_API;
        if (!this.config) {
            throw new Error('SMS API configuration not found');
        }
        
    // Use Render proxy server by default (configurable via RETAIL_CONFIG.SMS_API.PROXY_URL)
    // Avoid defaulting to localhost so GitHub/production doesn't accidentally hit a local dev proxy.
    this.proxyBaseURL = this.config.PROXY_URL || 'https://rs-proxy-1.onrender.com/api/sms';
        
        // Debug logging
        console.log('🔧 SMS API Config:', {
            baseUrl: this.config.BASE_URL,
            clientId: this.config.CLIENT_ID,
            hasSecret: !!this.config.CLIENT_SECRET,
            proxyURL: this.proxyBaseURL
        });
        
        console.log('🚀 SMS Portal API Handler loaded (via proxy)');
    }
    
    /**
     * Send SMS messages using proxy server
     */
    async sendSMS(message, recipients, options = {}) {
        if (!message || !message.trim()) {
            throw new Error('Message cannot be empty');
        }
        
        if (!recipients || recipients.length === 0) {
            throw new Error('No recipients specified');
        }
        
        try {
            console.log('📤 Sending SMS via proxy...', { recipientCount: recipients.length });
            
            const response = await fetch(`${this.proxyBaseURL}/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message.trim(),
                    recipients: recipients,
                    options: options
                })
            });
            
            const responseData = await response.json();
            
            if (response.ok && responseData.success) {
                console.log('✅ SMS sent successfully via proxy:', responseData);
                return responseData;
            } else {
                console.error('❌ SMS send failed:', responseData);
                throw new Error(`SMS send failed: ${responseData.error || response.status}`);
            }
            
        } catch (error) {
            console.error('🔥 SMS API Error:', error);
            throw new Error(`Failed to send SMS: ${error.message}`);
        }
    }
    
    /**
     * Get account balance from proxy server
     */
    async getBalance() {
        try {
            console.log('💰 Fetching SMS balance via proxy...');
            
            const response = await fetch(`${this.proxyBaseURL}/v1/Balance`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            const data = await response.json();
            
            if (response.ok) {
                // Balance API returns 200 with balance in response
                if (data.balance !== undefined) {
                    console.log('✅ Balance retrieved via proxy:', data.balance, 'credits');
                    return {
                        balance: data.balance,
                        currency: data.currency || 'ZAR',
                        data: data
                    };
                }
            }
            
            // If we reach here, something went wrong
            console.error('❌ Balance fetch failed:', data);
            if (response.status === 500 && data.type === 'proxy_error') {
                throw new Error('Proxy server error - please check if SMS proxy is running');
            }
            throw new Error(`Failed to get balance: ${data.error || response.statusText}`);
            
        } catch (error) {
            console.error('🔥 Balance API Error:', error);
            if (error.message.includes('Failed to fetch')) {
                throw new Error('Cannot connect to SMS proxy server - please ensure it is running on port 3001');
            }
            throw new Error(`Failed to get balance: ${error.message}`);
        }
    }
    
    /**
     * Get message history from proxy server
     */
    async getHistory(options = {}) {
        try {
            console.log('📊 Fetching SMS history via proxy...');
            
            // Build query parameters
            const params = new URLSearchParams();
            if (options.limit) params.append('limit', options.limit);
            if (options.offset) params.append('offset', options.offset);
            if (options.fromDate) params.append('fromDate', options.fromDate);
            if (options.toDate) params.append('toDate', options.toDate);
            
            const url = `${this.proxyBaseURL}/v1/Messages${params.toString() ? `?${params.toString()}` : ''}`;
            
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('✅ History retrieved via proxy:', { count: data.messages?.length || 0 });
                
                return {
                    messages: data.messages || [],
                    totalCount: data.totalCount || 0,
                    data: data.data
                };
            } else {
                const errorData = await response.json().catch(() => ({}));
                console.warn('⚠️ History fetch failed via proxy, using empty results:', errorData);
                
                return {
                    messages: [],
                    totalCount: 0,
                    data: { error: errorData }
                };
            }
            
        } catch (error) {
            console.warn('⚠️ History API Error via proxy, using empty results:', error);
            
            return {
                messages: [],
                totalCount: 0,
                data: { error: error.message }
            };
        }
    }
    
    /**
     * Test the API connection via proxy
     */
    async testConnection() {
        try {
            console.log('🧪 Testing SMS Portal connection via proxy...');
            
            const response = await fetch(`${this.proxyBaseURL}/test`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
                console.log('✅ SMS Portal connection test successful via proxy:', data);
                return data;
            } else {
                console.error('❌ SMS Portal connection test failed via proxy:', data);
                return data;
            }
            
        } catch (error) {
            console.error('🔥 Connection test error:', error);
            return { 
                success: false, 
                error: error.message.includes('Failed to fetch') 
                    ? 'Cannot connect to proxy server - please ensure it is running on port 3001'
                    : error.message,
                status: 'error'
            };
        }
    }
    
    /**
     * Format phone number for SMS Portal (South African format - NO + symbol)
     * SMS Portal requires: 27XXXXXXXXX (NOT +27XXXXXXXXX)
     */
    formatPhoneNumber(phone) {
        if (!phone) return '';
        
        // Remove all non-digit characters
        let cleaned = phone.toString().replace(/\D/g, '');
        
        // Handle South African numbers
        if (cleaned.startsWith('27')) {
            // Already has country code - return as is (no +)
            return cleaned;
        } else if (cleaned.startsWith('0')) {
            // Remove leading 0 and add SA country code (no +)
            return `27${cleaned.substring(1)}`;
        } else if (cleaned.length === 9) {
            // 9 digits without leading 0, add SA country code (no +)
            return `27${cleaned}`;
        }
        
        // Default: assume it needs SA country code if no country code present
        if (cleaned.length >= 9 && !cleaned.startsWith('27')) {
            return `27${cleaned}`;
        }
        
        return cleaned;
    }
    
    /**
     * Get API configuration info (for debugging)
     */
    getConfig() {
        return {
            baseUrl: this.config.BASE_URL,
            clientId: this.config.CLIENT_ID,
            senderId: this.config.SENDER_ID,
            // Show first/last few chars of credentials for debugging
            credentialsPreview: this.credentials ? `${this.credentials.substring(0,10)}...${this.credentials.substring(this.credentials.length-10)}` : 'none',
            // Don't expose the secret
            hasCredentials: !!(this.config.CLIENT_ID && this.config.CLIENT_SECRET)
        };
    }
    
    /**
     * Manual test function for debugging
     */
    async debugTest() {
        console.log('🔬 Debug Test - Configuration:', this.getConfig());
        
        // Test basic connectivity first
        console.log('🌐 Testing basic connectivity...');
        try {
            const response = await fetch(`${this.config.BASE_URL}/Credits`, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${this.credentials}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'RetailSolutions-SMSPortal/1.0'
                }
            });
            
            console.log('📡 Response Details:', {
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries())
            });
            
            const responseText = await response.text();
            console.log('📄 Raw Response:', responseText);
            
            let responseData;
            try {
                responseData = JSON.parse(responseText);
                console.log('📊 Parsed Response:', responseData);
            } catch (e) {
                console.log('⚠️ Could not parse response as JSON');
            }
            
            return {
                status: response.status,
                statusText: response.statusText,
                responseText,
                responseData
            };
            
        } catch (error) {
            console.error('❌ Debug test failed:', error);
            return { error: error.message };
        }
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.SMSAPIHandler = SMSAPIHandler;
    
    // Global debug function
    window.testSMSAPI = async function() {
        if (window.smsAPI) {
            console.log('🧪 Running SMS API debug test...');
            return await window.smsAPI.debugTest();
        } else {
            console.error('❌ SMS API not initialized');
            return { error: 'SMS API not initialized' };
        }
    };
}

console.log('📱 SMS Portal API Handler ready');