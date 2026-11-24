#!/bin/zsh
# Creates a ỌMA admin login on the LIVE Convex deployment. Asks for each detail; the
# password is never shown on screen or saved in your shell history.
cd "$(dirname "$0")/.." || exit 1
read "NAME?Your full name: "
read "EMAIL?Email you will sign in with: "
read -s "PW?Choose a password (8+ characters): " && echo
read -s "PW2?Type the password again: " && echo
if [[ "$PW" != "$PW2" ]]; then echo "The passwords don't match. Nothing was created."; exit 1; fi
if (( ${#PW} < 8 )); then echo "The password must be at least 8 characters. Nothing was created."; exit 1; fi
ARGS=$(NAME="$NAME" EMAIL="$EMAIL" PW="$PW" node -e 'console.log(JSON.stringify({ name: process.env.NAME, email: process.env.EMAIL, password: process.env.PW }))')
unset PW PW2
npx convex run --prod setup:createAdmin "$ARGS"
