-- Migration: add barbers, barber-specific booking overlaps, and 24h reminders
-- Run this once in Supabase SQL Editor for an existing database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS barbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO barbers (name, sort_order) VALUES
  ('Бейбарс', 1),
  ('Досжан', 2)
ON CONFLICT (name) DO UPDATE SET
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS barber_id UUID REFERENCES barbers(id) ON DELETE RESTRICT;

UPDATE bookings
SET barber_id = (SELECT id FROM barbers WHERE name = 'Бейбарс')
WHERE barber_id IS NULL;

ALTER TABLE bookings
  ALTER COLUMN barber_id SET NOT NULL;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS reminder_24h_sent BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_no_overlap;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (barber_id WITH =, time_range WITH &&)
  WHERE (status = 'confirmed');

CREATE INDEX IF NOT EXISTS idx_bookings_barber_id ON bookings (barber_id);
CREATE INDEX IF NOT EXISTS idx_barbers_active_sort ON barbers (is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_bookings_reminder_24h
  ON bookings (booking_time, status, reminder_24h_sent)
  WHERE status = 'confirmed' AND reminder_24h_sent = FALSE;
