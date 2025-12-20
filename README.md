# 🚀 RS Proxy Server - UPDATED for SMS Portal (Dec 2025)

Proxy server for Retail Solutions integrations - handles CORS and API authentication for:

- **MIE Background Checks** (SOAP API at qa.mie.co.za)
- **SMS Portal** (REST API at rest.smsportal.com)

**Both services work independently on the same server!**

---

## 📋 FILES TO UPLOAD TO GITHUB

Upload these **3 files** to your GitHub repository `Agile777/rs-proxy`:

1. ✅ **server.js** - Main proxy server (MIE + SMS endpoints) - **UPDATED**
2. ✅ **package.json** - Dependencies
3. ✅ **README.md** - This documentation

**After uploading, just update environment variables on Render.com (see below)**

---

## 🔐 ENVIRONMENT VARIABLES ON RENDER

### Step 1: Go to Render Dashboard

1. Visit: https://dashboard.render.com
2. Select your **rs-proxy** service
3. Click **Environment** tab

### Step 2: Add/Update These 6 Variables

#### MIE Background Checks (4 variables - KEEP EXISTING ✅):

```
MIE_USERNAME = style_professional_integration_qa
MIE_PASSWORD = (your MIE password)
MIE_CLIENT_KEY = 20408
MIE_AGENT_KEY = 54
```

#### SMS Portal (2 variables - **UPDATE THESE** ⚠️):

```
SMS_CLIENT_ID = 041c9a63-6173-4122-9695-16f71a621482
SMS_CLIENT_SECRET = kiw9iKn9UUoi+wMG9o9JGBzHbEMEW0WE
```

### Step 3: Save & Deploy

1. Click **Save Changes**
2. Render will **automatically redeploy** (takes ~2 minutes)
3. Check logs to verify deployment success

---

## 📂 DEPLOYMENT STEPS

### Option 1: GitHub Web Interface (EASIEST - No Git Required)

1. **Go to:** https://github.com/Agile777/rs-proxy
2. **Click on existing `server.js` file**
3. **Click pencil icon** (Edit this file)
4. **Select ALL and delete** (Ctrl+A, Delete)
5. **Copy entire content** from `sms-deploy\server.js`
6. **Paste into GitHub**
7. **Scroll down** → Click **"Commit changes"**
8. **Render auto-deploys** in ~1-2 minutes ✅

Repeat steps 2-7 for `package.json` if needed (usually doesn't change).

### Option 2: GitHub Desktop

1. Open GitHub Desktop
2. Navigate to `rs-proxy` repository
3. Copy files from `sms-deploy\` folder to repo folder
4. Commit changes
5. Push to origin
6. Render auto-deploys ✅

---

## ✅ TESTING THE DEPLOYMENT

### 1. Check Health Endpoint

Visit: `https://rs-proxy-hi0e.onrender.com/health`

**Expected Response:**

```json
{
  "ok": true,
  "service": "rs-local-proxy",
  "port": 3001,
  "time": "2025-12-20T...",
  "envVariablesDetected": {
    "MIE_PASSWORD": true,
    "MIE_USERNAME": true,
    "SMS_CLIENT_SECRET": true  ← Should be TRUE
  }
}
```

### 2. Check Your App Console

Open browser console (F12) on your app:

**SUCCESS indicators:**

```
✅ Balance retrieved via proxy: { balance: xxx, currency: "ZAR" }
✅ History retrieved via proxy: { count: xxx }
🔧 SMS API Config: { ... hasSecret: true ... }
```

**FAILURE indicators (should NOT appear):**

```
❌ SyntaxError: Unexpected token '<', "<!DOCTYPE "...
❌ Balance API Error: ...
```

---

## 🌐 INDEPENDENCE GUARANTEE

**MIE and SMS are completely separate:**

- Different endpoints: `/api/mie` vs `/api/sms/*`
- Different credentials: `MIE_*` vs `SMS_*`
- Different services: `qa.mie.co.za` vs `rest.smsportal.com`
- **Adding/updating SMS won't affect MIE functionality**

---

## 🔧 TROUBLESHOOTING

### HTML Error Responses (instead of JSON)

**Problem:** Getting `SyntaxError: Unexpected token '<'`

**Solution:**

1. Verify environment variables are EXACTLY as shown above
2. No extra spaces in credentials
3. Click "Save Changes" on Render
4. Wait for auto-deploy to complete
5. Hard refresh your app (Ctrl+Shift+R)

### Render Logs Show Errors

**Check:** https://dashboard.render.com → Your Service → Logs

**Look for:**

```
[rs-local-proxy] listening on http://0.0.0.0:3001
SMS Proxy Request: { method: 'GET', url: '...', hasAuth: true }
```

### Environment Variables Not Detected

**Problem:** Health endpoint shows `"SMS_CLIENT_SECRET": false`

**Solution:**

1. Go to Render → Environment
2. Re-enter the variables
3. Click Save Changes
4. Wait for redeploy

---

## 📖 API DOCUMENTATION

### SMS Portal REST API

**Base URL:** `https://rest.smsportal.com`

**Authentication:** HTTP Basic Auth

```
Username: SMS_CLIENT_ID (from environment variable)
Password: SMS_CLIENT_SECRET (from environment variable)
```

**Endpoints Used:**

- `GET /v1/Balance` - Get account balance
- `GET /v1/Messages` - Get message history
- `POST /v1/BulkMessages` - Send SMS messages

---

## 🔒 SECURITY NOTES

✅ **Credentials stored in Render environment variables** (secure)  
✅ **Client-side only has proxy URL** (no credentials exposed)  
✅ **Authentication handled server-side by proxy**  
⚠️ **Keep `SMS_CLIENT_SECRET` private** - never commit to Git  
⚠️ **Free Render apps sleep after 15 min** - first request takes ~30 sec

---

## 📞 SUPPORT

**Render Dashboard:** https://dashboard.render.com  
**Render Logs:** Dashboard → Your Service → Logs tab  
**Environment Vars:** Dashboard → Your Service → Environment tab

**Your Render Service URL:** `https://rs-proxy-hi0e.onrender.com`

---

## ✨ WHAT'S NEW (Dec 2025)

### SMS Proxy Updates:

- ✅ Full endpoint support (`/api/sms/*` wildcards)
- ✅ Proper HTTP Basic Auth implementation
- ✅ Updated credentials (new Client ID & Secret)
- ✅ Better error handling and logging
- ✅ Fallback credentials for development

### Before (broken):

- ❌ Only `/api/sms` POST endpoint
- ❌ Missing balance/history routes
- ❌ Old 2024 credentials

### After (fixed):

- ✅ All routes supported via wildcard
- ✅ GET/POST/PUT/DELETE all work
- ✅ Current 2025 credentials
- ✅ Complete API coverage

---

**Last Updated:** December 20, 2025  
**Version:** 1.0.0 (SMS Update)
