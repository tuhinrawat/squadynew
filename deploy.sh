#!/bin/bash

echo "🚀 Squady Deployment Script"
echo "=========================="
echo ""

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "📦 Installing Vercel CLI..."
    npm install -g vercel
fi

echo "✅ Vercel CLI ready"
echo ""

# Login to Vercel
echo "🔐 Logging into Vercel..."
vercel login

# Link project
echo "🔗 Linking project..."
vercel link

# Pull environment variables
echo "📥 Pulling environment variables..."
vercel env pull .env.local

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npx prisma generate

# Push database schema
echo "📊 Pushing database schema..."
npx prisma db push

# Seed database (optional)
echo "🌱 Seeding database..."
npx prisma db seed

echo ""
echo "✅ Setup complete!"
echo ""
echo "🌐 Your app is live at: https://squady.vercel.app"
echo ""
echo "📝 To deploy updates, just push to GitHub:"
echo "   git add ."
echo "   git commit -m 'Update'"
echo "   git push"

