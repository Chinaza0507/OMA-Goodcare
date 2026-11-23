-- Oma schema (v2, follows the MVP PRD). Safe to run more than once.
-- Money is stored as whole naira. Times are Nigerian local time (Africa/Lagos).

CREATE TABLE IF NOT EXISTS clinics (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  state                 TEXT,
  area                  TEXT,
  address               TEXT,
  landmark              TEXT,
  email                 TEXT,                     -- the hospital's official email
  latitude              DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
  longitude             DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
  -- New hospitals register themselves as pending and stay hidden from patients until an Oma admin approves.
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  type                  TEXT NOT NULL CHECK (type IN ('public', 'mission', 'private', 'school')),
  -- paid: deposit is taken. covered: fully covered school clinic, no deposit, booking rule instead.
  billing_type          TEXT NOT NULL DEFAULT 'paid' CHECK (billing_type IN ('paid', 'covered')),
  payment_option        TEXT NOT NULL DEFAULT 'per_patient' CHECK (payment_option IN ('per_patient', 'monthly')),
  grace_minutes         INTEGER NOT NULL DEFAULT 10 CHECK (grace_minutes BETWEEN 0 AND 120),
  cancel_window_minutes INTEGER NOT NULL DEFAULT 120 CHECK (cancel_window_minutes >= 0),
  deposit_naira         INTEGER NOT NULL DEFAULT 300 CHECK (deposit_naira >= 0),
  active                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id            UUID NOT NULL REFERENCES clinics (id),
  name                 TEXT NOT NULL,
  consultation_fee_naira INTEGER CHECK (consultation_fee_naira >= 0), -- NULL = not provided
  opens_at             TIME NOT NULL DEFAULT '08:00',
  closes_at            TIME NOT NULL DEFAULT '16:00',
  slot_minutes         INTEGER NOT NULL DEFAULT 20 CHECK (slot_minutes BETWEEN 5 AND 120),
  avg_visit_minutes    INTEGER NOT NULL DEFAULT 15 CHECK (avg_visit_minutes BETWEEN 1 AND 240),
  active               BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (clinic_id, name)
);

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role            TEXT NOT NULL CHECK (role IN ('patient', 'staff', 'manager', 'admin')),
  name            TEXT NOT NULL,
  phone           TEXT UNIQUE,                     -- patients: normalised to +234XXXXXXXXXX
  email           TEXT,                            -- hospital, staff and admin sign-in; optional for patients
  secret_hash     TEXT NOT NULL,                   -- patients: 4-digit PIN; staff: password
  language        TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'pcm', 'yo', 'ig', 'ha')),
  alert_ahead     INTEGER NOT NULL DEFAULT 3 CHECK (alert_ahead BETWEEN 1 AND 10),
  clinic_id       UUID REFERENCES clinics (id),    -- staff and managers belong to one clinic
  active          BOOLEAN NOT NULL DEFAULT true,   -- false = account disabled (e.g. staff who left)
  consent_at      TIMESTAMPTZ,                     -- NDPA consent
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (role NOT IN ('staff', 'manager') OR clinic_id IS NOT NULL)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS landmark TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS email TEXT;
-- Patients sign in with phone + PIN; hospital, staff and admin accounts with email + password.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_sign_in_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_sign_in_check
      CHECK ((role = 'patient' AND phone IS NOT NULL) OR (role <> 'patient' AND email IS NOT NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS users_work_email_idx ON users (lower(email)) WHERE role <> 'patient';

CREATE INDEX IF NOT EXISTS clinics_listing_idx ON clinics (status, state, area);

CREATE TABLE IF NOT EXISTS family_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES users (id),
  name       TEXT NOT NULL,
  age        INTEGER CHECK (age BETWEEN 0 AND 120),
  is_self    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS family_one_self_idx ON family_members (owner_id) WHERE is_self;

-- One Kolo wallet per family account (the account owner).
CREATE TABLE IF NOT EXISTS kolo_wallets (
  user_id          UUID PRIMARY KEY REFERENCES users (id),
  available_naira  INTEGER NOT NULL DEFAULT 0 CHECK (available_naira >= 0),
  reserved_naira   INTEGER NOT NULL DEFAULT 0 CHECK (reserved_naira >= 0)
);

-- A booking or a walk-in. The unique indexes below are what stop two people
-- taking the same slot, whether they book online or the front desk registers them.
CREATE TABLE IF NOT EXISTS appointments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        UUID NOT NULL REFERENCES clinics (id),
  department_id    UUID NOT NULL REFERENCES departments (id),
  family_member_id UUID REFERENCES family_members (id),
  booked_by        UUID REFERENCES users (id),    -- NULL for walk-ins without an account
  patient_name     TEXT NOT NULL,
  patient_phone    TEXT,
  type             TEXT NOT NULL CHECK (type IN ('booked', 'walk_in')),
  appt_date        DATE NOT NULL,
  slot_time        TIME NOT NULL,
  queue_number     INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'booked'
                   CHECK (status IN ('booked', 'checked_in', 'called', 'seen', 'cancelled', 'no_show')),
  deposit_naira    INTEGER NOT NULL DEFAULT 0,
  deposit_status   TEXT NOT NULL DEFAULT 'none'
                   CHECK (deposit_status IN ('none', 'held', 'deducted', 'returned', 'forfeited')),
  front_rank       INTEGER NOT NULL DEFAULT 0,    -- lower goes first; "move to front" lowers it
  alert_ahead      INTEGER NOT NULL DEFAULT 3 CHECK (alert_ahead BETWEEN 1 AND 10),
  arrived_at       TIMESTAMPTZ,
  called_at        TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  cancelled_by     TEXT CHECK (cancelled_by IN ('patient', 'clinic')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, appt_date, queue_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS appointments_slot_unique
  ON appointments (department_id, appt_date, slot_time) WHERE status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS appointments_member_day_unique
  ON appointments (department_id, appt_date, family_member_id)
  WHERE status <> 'cancelled' AND family_member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS appointments_queue_idx ON appointments (department_id, appt_date, status);
CREATE INDEX IF NOT EXISTS appointments_booked_by_idx ON appointments (booked_by);

CREATE TABLE IF NOT EXISTS kolo_transactions (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users (id),
  type             TEXT NOT NULL CHECK (type IN ('topup', 'hold', 'deduct', 'refund', 'forfeit')),
  amount_naira     INTEGER NOT NULL CHECK (amount_naira > 0),
  appointment_id   UUID REFERENCES appointments (id),
  available_after  INTEGER NOT NULL,
  reserved_after   INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kolo_tx_user_idx ON kolo_transactions (user_id, created_at DESC);

-- School clinics: first no-show warns, second blocks booking for 7 days.
CREATE TABLE IF NOT EXISTS noshow_tracking (
  user_id       UUID NOT NULL REFERENCES users (id),
  clinic_id     UUID NOT NULL REFERENCES clinics (id),
  miss_count    INTEGER NOT NULL DEFAULT 0,
  blocked_until TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, clinic_id)
);

CREATE TABLE IF NOT EXISTS action_log (
  id             BIGSERIAL PRIMARY KEY,
  clinic_id      UUID NOT NULL REFERENCES clinics (id),
  actor_id       UUID REFERENCES users (id),
  actor_name     TEXT NOT NULL,
  action         TEXT NOT NULL,
  appointment_id UUID REFERENCES appointments (id),
  patient_name   TEXT,
  reason         TEXT,
  details        JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS action_log_clinic_idx ON action_log (clinic_id, created_at DESC);

-- The Kolo history and the action log can never be edited or deleted.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kolo_tx_append_only ON kolo_transactions;
CREATE TRIGGER kolo_tx_append_only BEFORE UPDATE OR DELETE ON kolo_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

DROP TRIGGER IF EXISTS action_log_append_only ON action_log;
CREATE TRIGGER action_log_append_only BEFORE UPDATE OR DELETE ON action_log
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
