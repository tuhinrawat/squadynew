# 🚀 Deploy Squady to Vercel (5 Minutes)

## Step 1: Go to Vercel
Visit: **https://vercel.com/login**
- Click "Continue with GitHub"
- Authorize Vercel

## Step 2: Import Your Project
1. Click **"Add New Project"**
2. Select your **`squady`** repository
3. Click **"Import"**

## Step 3: Get Free Database
**Go to https://supabase.com/create-project**
1. Click "New Project"
2. Name: `squady-db`
3. Create password (SAVE THIS!)
4. Select region closest to you
5. Click "Create new project"
6. Wait ~2 minutes for setup
7. Go to: Settings → Database
8. Copy the "Connection string" (looks like: `postgresql://postgres:[password]@...`)

## Step 4: Get Pusher Account
**Go to https://pusher.com/signup**
1. Create free account
2. Click "Create app"
3. Name: `squady`
4. Cluster: Choose closest to you (e.g., `ap-south-1` for India)
5. Create app
6. Copy these values from "Keys":
   - `app_id`
   - `key`
   - `secret`
   - `cluster`

## Step 5: Add Environment Variables in Vercel
**In Vercel project settings:**
1. Go to: Settings → Environment Variables
2. Add these variables:

```bash
# Database
DATABASE_URL
= paste-your-supabase-connection-string-here

# NextAuth.js Secret (Generate random string)
NEXTAUTH_SECRET
= (use this command to generate: openssl rand -base64 32)

# NextAuth URL (update after deployment)
NEXTAUTH_URL
= https://your-app-name.vercel.app

# Pusher Server-side
PUSHER_APP_ID
= your-pusher-app-id

PUSHER_KEY
= your-pusher-key

PUSHER_SECRET
= your-pusher-secret

PUSHER_CLUSTER
= your-pusher-cluster

# Pusher Client-side (Same as above)
NEXT_PUBLIC_PUSHER_KEY
= your-pusher-key

NEXT_PUBLIC_PUSHER_CLUSTER
= your-pusher-cluster
```

**Generate NEXTAUTH_SECRET:**
```bash
openssl rand -base64 32
```

## Step 6: Deploy
1. In Vercel, click **"Deploy"**
2. Wait 2-3 minutes for build
3. Your site will be live at: `https://your-app-name.vercel.app`

## Step 7: Initialize Database
**After deployment succeeds:**
```bash
# In your terminal (in the squady directory)
npx vercel login
npx vercel env pull .env.local

# Run database setup
npx prisma generate
npx prisma db push
npx prisma db seed
```

Or use Vercel CLI to connect to production:
```bash
npx prisma studio --browser none  # Local dev only

# For production database, use Supabase SQL Editor
# Or connect via psql:
psql "your-database-url-here"
# Then run migration SQL manually
```

## Step 8: Test Your Live Site
1. Visit your Vercel URL
2. Click "Sign In"
3. Use these test credentials:
   - Email: `admin@squady.com`
   - Password: `admin123` (check your seed file)
4. You should see the dashboard! 🎉

## Update NEXTAUTH_URL
After deployment, update the `NEXTAUTH_URL` environment variable in Vercel to your actual URL:
1. Go to: Settings → Environment Variables
2. Edit `NEXTAUTH_URL`
3. Set to: `https://your-actual-url.vercel.app`
4. Redeploy

## 🎉 You're Live!
Your Squady auction system is now live at: **https://your-app.vercel.app**

---

## Future Deployments
Every time you push to GitHub:
- Vercel automatically deploys
- No need to run anything manually

---

## Troubleshooting

**Build fails?**
- Check all env vars are set
- Check Vercel logs

**Database connection error?**
- Verify Supabase is not paused
- Check DATABASE_URL is correct

**Can't login?**
- Check NEXTAUTH_SECRET is set
- Update NEXTAUTH_URL to your live URL

**Pusher not working?**
- Verify all Pusher env vars are set
- Check Pusher dashboard

---

## Cost: $0/month 🆓
- Vercel: Free tier
- Supabase: Free tier (500MB database)
- Pusher: Free tier (200k messages/day)

---

## Need Help?
Check deployment logs in Vercel dashboard:
- Go to your project
- Click "Deployments"
- Click latest deployment
- View "Build Logs"

