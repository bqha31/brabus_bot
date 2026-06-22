-- Migration: add followup_reminder_sent_at column to bookings
-- Run this once in Supabase SQL Editor

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS followup_reminder_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bookings_followup_reminder
  ON bookings (booking_time, status, followup_reminder_sent_at)
  WHERE status = 'confirmed' AND followup_reminder_sent_at IS NULL;
