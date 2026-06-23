-- Barbershop schema for Supabase (PostgreSQL)

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'individual' CHECK (category IN ('individual', 'complex')),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS barbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  barber_id UUID NOT NULL REFERENCES barbers(id) ON DELETE RESTRICT,
  booking_time TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  reminder_24h_sent BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_sent BOOLEAN NOT NULL DEFAULT FALSE,
  followup_reminder_sent_at TIMESTAMPTZ,
  -- Snapshot of the occupied interval, used to prevent any overlapping bookings
  -- (not just bookings starting at the exact same minute).
  time_range TSTZRANGE GENERATED ALWAYS AS (
    tstzrange(booking_time, booking_time + (duration_minutes || ' minutes')::interval, '[)')
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ
);

-- Prevents two confirmed bookings from overlapping for the same barber.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_no_overlap;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (barber_id WITH =, time_range WITH &&)
  WHERE (status = 'confirmed');

CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings (customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_service_id ON bookings (service_id);
CREATE INDEX IF NOT EXISTS idx_bookings_barber_id ON bookings (barber_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_time ON bookings (booking_time);
CREATE INDEX IF NOT EXISTS idx_bookings_reminder_24h
  ON bookings (booking_time, status, reminder_24h_sent)
  WHERE status = 'confirmed' AND reminder_24h_sent = FALSE;
CREATE INDEX IF NOT EXISTS idx_bookings_followup_reminder
  ON bookings (booking_time, status, followup_reminder_sent_at)
  WHERE status = 'confirmed' AND followup_reminder_sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);
CREATE INDEX IF NOT EXISTS idx_services_category_sort ON services (category, sort_order);
CREATE INDEX IF NOT EXISTS idx_barbers_active_sort ON barbers (is_active, sort_order);

-- NOTE for an existing/live database:
-- This file uses CREATE TABLE IF NOT EXISTS, so it will NOT add the new
-- columns/tables (barbers, barber_id, category, sort_order, is_active,
-- reminder_24h_sent, reminder_sent,
-- followup_reminder_sent_at, duration_minutes, time_range, cancelled_at) to
-- tables that already exist. If you already ran the old schema, the simplest
-- path for a test project is to drop and recreate:
--   DROP TABLE IF EXISTS bookings CASCADE;
--   DROP TABLE IF EXISTS services CASCADE;
-- then re-run this file and seed.sql.
