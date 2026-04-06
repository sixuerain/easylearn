#!/bin/bash
set -e

cd "$(dirname "$0")"

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Apply database migrations (creates DB if needed)
npx prisma db push

# Start dev server
npm run dev
