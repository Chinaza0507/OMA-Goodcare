# ỌMA — Good Care

A hospital queue booking web app. Patients book a slot and follow their live place in the queue; staff manage the queue; admins manage departments and doctors.

## Status
Early development. Client and server scaffolded; database schema and auth are next.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React (Vite) + Tailwind CSS |
| Backend | Node.js + Express |
| Database | PostgreSQL (hosted on Neon or Supabase) |
| Live updates | Socket.IO |
| Auth | JWT + bcrypt, role-based (patient / staff / admin) |
| Validation | Zod |
| Testing | Vitest (frontend), Jest + Supertest (backend) |
| Notifications | Email / SMS (later phase) |

## Roles and features

- **Patient:** register and log in, book a slot by department, see live queue position, cancel a booking.
- **Staff:** view today's queue, call the next patient, mark done or no-show.
- **Admin:** manage departments, doctors and opening hours.

## Planned structure

```
OMA-Goodcare/
├── client/     # React app
├── server/     # Express API
└── docs/       # Notes and decisions
```

## Roadmap

1. Project setup (client, server, database connection)
2. Database schema and authentication
3. Booking flow
4. Live queue (Socket.IO)
5. Staff dashboard
6. Admin tools
7. Notifications, testing and deployment

## Security and privacy

This handles patient data, so:
- Never commit secrets. Copy `server/.env.example` to `server/.env` and fill it in locally.
- Hash all passwords, validate all input, and enforce roles on the server.
- Collect only the patient data the queue needs.

## Getting started

Requires Node.js 20+ and a PostgreSQL database (Neon or Supabase).

```bash
# 1. Server
cd server
cp .env.example .env     # then fill in DATABASE_URL, JWT_SECRET and PIN_PEPPER
npm install
npm run migrate          # create the tables (safe to re-run)
npm run seed             # development only: two sample hospitals + sample staff (passwords printed once)
npm run dev              # http://localhost:5001  (check /api/health)

# 2. Client (in a second terminal)
cd client
npm install
npm run dev              # http://localhost:5173
```

The client proxies `/api` and `/socket.io` to the server, so no extra config is needed in development.

### Accounts

| Who | How they get an account |
|---|---|
| Patient | Signs up in the app: name, Nigerian phone number, 4-digit PIN, consent |
| Hospital manager | "Sign in as hospital": registers the hospital and becomes its manager. The hospital stays hidden from patients until an Oma admin approves it |
| Front-desk staff | Created by their hospital's manager |
| Oma admin | Created from the terminal (below) |

```bash
cd server
NEW_USER_PASSWORD='choose-a-strong-password' npm run create-admin -- "Full Name" 08012345678
```

### Rules implemented (from the PRD)

- **Deposit:** a booking at a normal (paid) hospital reserves ₦300 from the family's Kolo. It is deducted from the fee when staff mark the patient seen (returned to Kolo at a free clinic), returned on early cancellation (2+ hours before, per clinic) or hospital cancellation, and forfeited to the hospital on a verified no-show. Walk-ins never pay a deposit.
- **School clinics** (type `school`, set at registration; only an Oma admin can change it): no deposit. First no-show is a warning; the second blocks booking for 7 days. Walk-ins are still allowed.
- **One schedule:** online bookings and front-desk walk-ins share each department's slots, so a time taken either way disappears from the other and nobody can double-book. The booked time is an arrival time, not a guaranteed consultation time.
- **Wait estimate:** people ahead x the department's average consultation time today (the last 10 patients seen), using the clinic's set average until 10 have been seen.
- **No-show:** only after the clinic's grace period (default 10 minutes) from when the patient was called.
- **Append-only records:** the Kolo history and the action log cannot be edited or deleted (enforced in the database).
- **Privacy:** the public "Now serving" screen exposes first names and queue numbers only. Staff are limited to their own hospital, and attempts to reach another hospital's data are refused and logged.
- **Money is simulated.** Real Kolo balances need a licensed financial partner (Phase 2).

### Assumptions to confirm with the product manager

- Cancelling a booked, paid visit inside the cancellation window forfeits the deposit to the hospital (after the patient confirms).
- Patient PIN login (the PRD says name and phone only) was added so a phone number alone cannot open someone's account and Kolo.
- The PRD's "hold the slot for 10 minutes when Kolo is too low" is not built yet: the booking is refused with `kolo_low` and the patient tops up and tries again.
- Reschedule, the billing report, offline sync and Hausa/Igbo/Yoruba text are not built yet.

### API

Errors return `{ "error": "<code>", ... }`. The client turns the code into text in the user's language.

| Area | Endpoints |
|---|---|
| Public | `GET /api/health` · `GET /api/clinics` (filters `state`, `area`, `maxFee`, `lat`+`lng` for nearest first) · `GET /api/clinics/locations` · `GET /api/clinics/:id` · `GET /api/clinics/departments/:id/slots?date=` · `GET /api/public/clinics/:id/now-serving` |
| Auth | `POST /api/auth/register` · `POST /api/auth/login` · `GET/PATCH /api/auth/me` · `POST /api/hospitals/register` |
| Patient | `/api/family` · `/api/appointments` (book, list, detail, cancel, alert) · `/api/kolo` (balances, top-up, transactions) |
| Front desk | `/api/staff/today` · `/stats` · `/log` · `/noshows` · `/walk-ins` · `/appointments/:id/{check-in,call,seen,no-show,move-to-front,requeue}` · `/departments/:id/call-next` · `/cancel-day` |
| Manager | `/api/manager/clinic` · `/departments` · `/staff` |
| Oma admin | `/api/admin/clinics` · `/clinics/:id/approve` · `PATCH /clinics/:id` |

Live updates: connect with Socket.IO and send `join` with `{ departmentId }` or `{ clinicId }`; the server emits `queue:changed`, then refetch through the API.

### Tests

The end-to-end test resets its database, so point it at a throwaway one (it refuses anything that is not local or named `test`):

```bash
cd server
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/oma_test npm test
```
