#!/bin/zsh
# Changes the live admin login from you@example.com to your real email. Your password stays the same.
cd "$(dirname "$0")/.." || exit 1
read "EMAIL?Your real email (for signing in at /admin): "
ARGS=$(EMAIL="$EMAIL" node -e 'console.log(JSON.stringify({ from: "you@example.com", to: process.env.EMAIL }))')
npx convex run --prod setup:changeAdminEmail "$ARGS"
