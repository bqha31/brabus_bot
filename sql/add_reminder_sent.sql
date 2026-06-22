-- Migration: add reminder_sent column to bookings
-- Run this once in Supabase SQL Editor

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_bookings_reminder
  ON bookings (booking_time, status, reminder_sent)
  WHERE status = 'confirmed' AND reminder_sent = FALSE;
