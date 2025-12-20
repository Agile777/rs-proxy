# RS Proxy Server for Render.com

Proxy server for Retail Solutions integrations - handles CORS and API authentication for:

- **MIE Background Checks** (SOAP API at qa.mie.co.za)
- **SMS Portal** (REST API at rest.smsportal.com)

**Both services work independently on the same server!**

---

## 📁 Files to Upload to GitHub

Upload these 3 files to your GitHub repository `Agile777/rs-proxy`:

1. ✅ `server.js` - Main proxy server (MIE + SMS endpoints)
2. ✅ `package.json` - Dependencies
3. ✅ `README.md` - This documentation

**After uploading, just add environment variables on Render.com (see below)**

---

## 🚀 Deployment Instructions

### Step 1: Upload Files to GitHub

Use GitHub Desktop or manual upload to push these 3 files to `Agile777/rs-proxy`

### Step 2: Add Environment Variables on Render.com

1. Go to: https://dashboard.render.com
2. Select your `rs-proxy` service
3. Click **Environment** tab
4. Add the 6 variables below:

### MIE Background Checks (4 variables - ALREADY SET ✅):

```
MIE_USERNAME = style_professional_integration_qa
MIE_PASSWORD = (your MIE password)
MIE_CLIENT_KEY = 20408
MIE_AGENT_KEY = 54
```

### SMS Portal (2 NEW variables - ADD THESE ⚠️):

```
SMS_CLIENT_ID = 71415477-3d64-4a68-b642-f182a9425402
SMS_CLIENT_SECRET = ccd055fa-e1b7-4d08-bee2-b51f23ac8afe
```

5. Click **Save Changes**
6. Wait ~2 minutes for auto-deploy

**Total: 6 environment variables**

---

## 🌐 Deployed Endpoints

**GitHub Repo:** https://github.com/Agile777/rs-proxy  
**Render URL:** https://rs-proxy-hi0e.onrender.com

### Available Endpoints:

- `GET /health` - Server health check (shows which env vars are loaded)
- `POST /api/mie` - MIE Background Checks proxy (uses MIE\_\* variables)
- `POST /api/sms` - SMS Portal proxy (uses SMS\_\* variables)

---

## ✅ Testing After Deployment

### 1. Health Check:

```
GET https://rs-proxy-hi0e.onrender.com/health
```

**Expected:** Should show 6 environment variables detected

### 2. MIE Endpoint (Should still work):

From `1_mie-background-checks.html`, submit a background check.
**Expected:** Success with RequestKey

### 3. SMS Endpoint (Should now work):

From `1_sms-portal.html`, load the page.
**Expected:** Shows SMS balance and credits

---

## 🔄 Auto-Deploy Process

Render is connected to your GitHub repo:

1. You push changes to GitHub
2. Render detects the push automatically
3. Rebuilds and deploys (~2 minutes)
4. Both MIE and SMS endpoints remain available during deployment

---

## 🛡️ Independence Guarantee

**MIE and SMS are completely separate:**

- Different endpoints: `/api/mie` vs `/api/sms`
- Different credentials: `MIE_*` vs `SMS_*`
- Different services: `qa.mie.co.za` vs `rest.smsportal.com`
- **Adding SMS won't affect MIE functionality**

---

## 📞 Support

For issues:

1. Check Render logs: https://dashboard.render.com → Logs
2. Test health endpoint to verify variables
3. Verify each service independently

- **Render Dashboard:** https://dashboard.render.com
- **Render Logs:** Dashboard → Your Service → Logs tab
- **Environment Vars:** Dashboard → Your Service → Environment tab

In your main project's config.js, update:

```javascript
PROXY_URL: 'https://YOUR-RENDER-URL.onrender.com/api/mie',
```

Replace `YOUR-RENDER-URL` with your actual Render URL.

### 6. Test:

Visit: `https://YOUR-RENDER-URL.onrender.com/health`

You should see JSON response with `"ok": true`

---

## Alternative: Deploy to Railway.app or Heroku

Same files work on Railway.app or Heroku - just change environment variables accordingly.

## Note:

⚠️ Free Render apps sleep after 15 minutes of inactivity. First request after sleep takes ~30 seconds.
Upgrade to paid ($7/month) to keep always active.
