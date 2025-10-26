# Squady Deployment Guide

## 🚀 Deploy to Vercel (Fastest & Easiest - RECOMMENDED)

### Prerequisites
- GitHub repository pushed (✅ Already done)
- Vercel account (free at [vercel.com](https://vercel.com))
- PostgreSQL database (free options below)

### Steps:

1. **Sign up for Vercel** (https://vercel.com)
   - Use GitHub to sign in

2. **Import your GitHub project** in Vercel Dashboard
   - Click "Add New Project"
   - Select `tuhinrawat/squady`
   - Click "Import"

3. **Configure Environment Variables** in Vercel:
   
   Add these variables in Vercel project settings → Environment Variables:
   
   ```env
   # Database (you'll need to set up a PostgreSQL database first)
   DATABASE_URL="postgresql://..."
   
   # NextAuth.js - Generate a secure random string
   NEXTAUTH_SECRET="generate-random-string-here"
   NEXTAUTH_URL="https://your-app.vercel.app"
   
   # Pusher (Server-side)
   PUSHER_APP_ID="your-pusher-app-id"
   PUSHER_KEY="your-pusher-key"
   PUSHER_SECRET="your-pusher-secret"
   PUSHER_CLUSTER="your-pusher-cluster"
   
   # Pusher (Client-side)
   NEXT_PUBLIC_PUSHER_KEY="your-pusher-key"
   NEXT_PUBLIC_PUSHER_CLUSTER="your-pusher-cluster"
   ```

4. **Set up PostgreSQL Database** (FREE options):

   **Option A: Supabase (Recommended - Easiest)**
   - Go to [supabase.com](https://supabase.com)
   - Create free account
   - Create new project
   - Copy connection string from Settings → Database
   - Update `DATABASE_URL` in Vercel

   **Option B: Neon.tech** (Also free)
   - Go to [neon.tech](https://neon.tech)
   - Create free account
   - Create project
   - Copy connection string
   - Update `DATABASE_URL` in Vercel

5. **Set up Pusher**
   - Go to [pusher.com](https://pusher.com)
   - Create free account
   - Create new app
   - Copy credentials to Vercel environment variables

6. **Deploy!**
   - Vercel will automatically deploy
   - Wait for build to complete
   - You'll get a live URL like: `https://squady.vercel.app`

7. **Initialize Database** (after first deployment):
   ```bash
   # Install Vercel CLI
   npm i -g vercel
   
   # Connect to your project
   vercel login
   vercel link
   
   # Run migrations
   vercel env pull .env.local  # Pull env vars
   npx prisma generate
   npx prisma db push
   npx prisma db seed
   ```

8. **Access your live site!** 🎉

---

## 🚂 Deploy to Railway (Alternative)

### Steps:

1. **Go to [railway.app](https://railway.app)**
   - Sign in with GitHub

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your `squady` repository

3. **Add PostgreSQL Service**
   - Click "New" → "Database" → "PostgreSQL"
   - Railway auto-creates a PostgreSQL instance
   - Copy the DATABASE_URL

4. **Configure Service**
   - In your app service, click "Variables"
   - Add all environment variables

5. **Deploy**
   - Railway will auto-deploy on every push to main

6. **Initialize Database**
   - SSH into Railway
   - Run: `npx prisma generate && npx prisma db push && npx prisma db seed`

---

## 🛠️ Deploy to Render (Alternative)

1. **Go to [render.com](https://render.com)**
2. **Create Web Service** → Connect GitHub repo
3. **Create PostgreSQL Database**
4. **Add environment variables**
5. **Auto-deploy on git push**

---

## ⚡ Quick Deployment Checklist

- [ ] Push code to GitHub (✅ Done)
- [ ] Sign up for Vercel
- [ ] Import GitHub repo in Vercel
- [ ] Set up Supabase PostgreSQL (free)
- [ ] Set up Pusher account (free)
- [ ] Add environment variables to Vercel
- [ ] Deploy
- [ ] Run database migrations
- [ ] Test your live site!

---

## 🎯 Recommended Stack for Production

**Frontend & Backend**: Vercel  
**Database**: Supabase (free tier)  
**Real-time**: Pusher (free tier)  
**Total Cost**: $0/month

---

## 📝 Post-Deployment Steps

1. **Generate NEXTAUTH_SECRET**:
   ```bash
   openssl rand -base64 32
   ```

2. **Update NEXTAUTH_URL** to your Vercel URL

3. **Test locally before deploying**:
   ```bash
   npm run build
   npm start
   ```

4. **Monitor logs** in Vercel dashboard

---

## 🆘 Troubleshooting

**Build fails?**
- Check environment variables are set
- Ensure `DATABASE_URL` is correct

**Database connection issues?**
- Verify Supabase connection string
- Check if database is paused (wake it up in Supabase dashboard)

**Pusher not working?**
- Verify all Pusher env vars are set
- Check Pusher dashboard for errors

**Page not loading?**
- Check Vercel deployment logs
- Verify build succeeded

---

## 🚀 Quick Start (5 minutes)

1. [Sign up for Vercel](https://vercel.com/signup)
2. [Create Supabase Database](https://supabase.com/dashboard)
3. [Create Pusher App](https://pusher.com)
4. Import your GitHub repo in Vercel
5. Add environment variables
6. Deploy!

Your live site: `https://your-app.vercel.app`

