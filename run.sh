#!/bin/bash
set -e

cd "$(dirname "$0")"

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Apply database migrations (creates DB if needed)
DATABASE_URL="file:../dev.db" npx prisma db push

# Seed default user if needed
node -e "
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const db = new Database('dev.db');
const exists = db.prepare('SELECT 1 FROM User WHERE username = ?').get('admin');
if (!exists) {
  const hash = bcrypt.hashSync('easylearn', 10);
  db.prepare('INSERT INTO User (id, username, password) VALUES (?, ?, ?)').run('admin-001', 'admin', hash);
  console.log('Seeded: admin / easylearn');
} else {
  console.log('Admin user already exists');
}
"

# Kill any existing dev server
pkill -f "next dev" 2>/dev/null || true

# Clean stale Next.js cache
rm -rf .next node_modules/.cache

# Start dev server
npm run dev
