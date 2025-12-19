# RS Proxy Server for Render.com

This folder contains only the files needed to deploy your proxy server to Render.com.

## Files:

- `server.js` - The proxy server (handles MIE and SMS API calls)
- `package.json` - Node.js dependencies
- `README.md` - This file

## Quick Deploy to Render.com:

### 1. Upload to GitHub:

1. Go to https://github.com and sign in
2. Create new repository: `rs-proxy`
3. Upload these files: `server.js` and `package.json`

### 2. Deploy on Render.com:

1. Go to https://render.com and sign up (free)
2. Click "New +" → "Web Service"
3. Connect to your GitHub repository
4. Configure:
   - **Name**: rs-proxy
   - **Environment**: Node
   - **Build Command**: npm install
   - **Start Command**: node server.js
   - **Plan**: Free

### 3. Add Environment Variables:

In Render dashboard, add these environment variables:

```
MIE_USERNAME = style_professional_integration_qa
MIE_PASSWORD = R3T@il5488
MIE_CLIENT_KEY = 20408
MIE_AGENT_KEY = 54
MIE_EMAIL = brandon@retail-solutions.co.za
SMS_CLIENT_ID = 71415477-3d64-4a68-b642-f182a9425402
SMS_CLIENT_SECRET = ccd055fa-e1b7-4d08-bee2-b51f23ac8afe
```

### 4. Get Your URL:

After deployment, Render will give you a URL like:
`https://rs-proxy.onrender.com`

### 5. Update config.js:

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
