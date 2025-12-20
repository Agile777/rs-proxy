# 📱 SMS Portal API - Live Connection Setup

## ✅ COMPLETED: Local Configuration

Updated credentials in [config.js](config.js):

- **Client ID:** `041c9a63-6173-4122-9695-16f71a621482`
- **API Secret:** `kiw9iKn9UUoi+wMG9o9JGBzHbEMEW0WE`

## 🚀 NEXT STEPS: Deploy to Render

### Step 1: Update Render Environment Variables

1. **Go to Render Dashboard:** https://dashboard.render.com
2. **Select your service:** `rs-proxy-hi0e` (or similar)
3. **Navigate to:** Environment → Environment Variables
4. **Add/Update these variables:**

```
SMS_CLIENT_ID = 041c9a63-6173-4122-9695-16f71a621482
SMS_CLIENT_SECRET = kiw9iKn9UUoi+wMG9o9JGBzHbEMEW0WE
```

5. **Click "Save Changes"**
6. **Render will automatically redeploy** (takes ~1-2 minutes)

### Step 2: Deploy Updated Proxy Code

Since we've updated the proxy server logic in `render-deploy/server.js`, you need to deploy it:

**Option A: Git Deploy (Recommended)**

```powershell
cd "c:\!!! RS 18 Dec 2025\render-deploy"
git add .
git commit -m "Update SMS proxy with new credentials and endpoints"
git push origin main
```

**Option B: Manual Deploy via Render Dashboard**

1. Go to your Render service
2. Click "Manual Deploy" → "Deploy latest commit"
3. Wait for deployment to complete

### Step 3: Test the Connection

After deployment completes:

1. **Hard refresh your app:** Press `Ctrl+Shift+R`
2. **Open browser console:** Press `F12`
3. **Look for these SUCCESS indicators:**

```
✅ Balance retrieved via proxy: { balance: xxx, currency: "ZAR" }
✅ History retrieved via proxy: { count: xxx }
🔧 SMS API Config: { ... hasSecret: true ... }
```

4. **Old ERROR should be GONE:**

```
❌ SHOULD NOT SEE: "SyntaxError: Unexpected token '<'"
```

## 📊 Current Status

| Component       | Status     | Notes                           |
| --------------- | ---------- | ------------------------------- |
| Local config.js | ✅ Updated | New credentials in place        |
| Proxy server.js | ✅ Updated | Full SMS endpoint support added |
| Render env vars | ⏳ Pending | **YOU NEED TO SET**             |
| Deployment      | ⏳ Pending | **YOU NEED TO DEPLOY**          |

## 🔧 Troubleshooting

### If you still see HTML errors after deploy:

1. **Check environment variables are set:**

   - Go to Render → Environment
   - Verify `SMS_CLIENT_ID` and `SMS_CLIENT_SECRET` exist
   - Values should match the ones above

2. **Check deployment logs:**

   - Go to Render → Logs
   - Look for: `[rs-local-proxy] listening on http://0.0.0.0:3001`
   - Look for: `SMS Proxy Request:` entries when you test

3. **Verify proxy URL in browser:**
   - Open: https://rs-proxy-hi0e.onrender.com/health
   - Should show: `"SMS_CLIENT_SECRET": true`

### Common Issues:

**HTML instead of JSON response:**

- ❌ Wrong credentials (check env vars match exactly)
- ❌ API endpoint changed (verify `https://rest.smsportal.com` is correct)
- ❌ Authentication format wrong (we're using Basic Auth now)

**"Cannot connect to proxy":**

- ❌ Render service is down (check dashboard)
- ❌ Wrong PROXY_URL in config.js (verify it matches Render URL)

## 📖 API Documentation

**SMS Portal REST API Base:** `https://rest.smsportal.com`

**Authentication:** HTTP Basic Auth

```
Username: CLIENT_ID
Password: CLIENT_SECRET
```

**Endpoints we use:**

- `GET /v1/Balance` - Get account balance
- `GET /v1/Messages` - Get message history
- `POST /v1/BulkMessages` - Send SMS messages

## 🔐 Security Notes

- ✅ Credentials are stored in Render environment variables (secure)
- ✅ Client-side config.js only has non-sensitive proxy URL
- ✅ Authentication handled server-side by proxy
- ⚠️ Keep `SMS_CLIENT_SECRET` private - never commit to Git

## ✨ What's Changed

**Before (broken):**

- Proxy only handled authentication endpoint
- Missing balance/history/send endpoints
- Old credentials from 2024

**After (fixed):**

- Full proxy support for all SMS endpoints
- Proper HTTP Basic Auth implementation
- New credentials from 2025
- Better error handling and logging
