/**
 * reminderService.js
 *
 * Sends WhatsApp reminders for upcoming bookings and haircut follow-ups.
 * Runs on a configurable interval (default: every 10 minutes).
 */

const { supabase } = require('./supabase');
const { sendTrackedClientPrompt, formatFollowUpPrompt } = require('./bookingService');

const REMINDER_LEAD_MINUTES = parseInt(process.env.REMINDER_LEAD_MINUTES || '120', 10);
const REMINDER_WINDOW_MINUTES = parseInt(process.env.REMINDER_WINDOW_MINUTES || '15', 10);
const REMINDER_INTERVAL_MS = parseInt(process.env.REMINDER_INTERVAL_MS || '600000', 10);
const FOLLOWUP_MIN_DAYS = parseInt(process.env.FOLLOWUP_MIN_DAYS || '21', 10);
const FOLLOWUP_MAX_DAYS = parseInt(process.env.FOLLOWUP_MAX_DAYS || '28', 10);

const DAY_MS = 24 * 60 * 60 * 1000;

function formatReminderTime(isoString) {
  const tz = process.env.TIMEZONE || 'Asia/Almaty';
  const date = new Date(isoString);
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function buildReminderMessage(serviceName, bookingTimeIso) {
  return `🔔 Напоминание от Brabus Barbershop!

Вы записаны: ${formatReminderTime(bookingTimeIso)}
Услуга: ${serviceName}

Ждём вас! Если планы изменились — напишите нам, чтобы отменить или перенести запись.`;
}

async function sendReminders() {
  const now = new Date();
  const windowStart = new Date(now.getTime() + REMINDER_LEAD_MINUTES * 60_000);
  const windowEnd = new Date(windowStart.getTime() + REMINDER_WINDOW_MINUTES * 60_000);

  let bookings;
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select(
        'id, booking_time, customer:customers(phone, name), service:services(name)'
      )
      .eq('status', 'confirmed')
      .eq('reminder_sent', false)
      .gte('booking_time', windowStart.toISOString())
      .lt('booking_time', windowEnd.toISOString());

    if (error) throw error;
    bookings = data || [];
  } catch (err) {
    console.error('[Reminders] Failed to fetch bookings:', err.message);
    return;
  }

  if (!bookings.length) return;

  console.log(`[Reminders] Sending ${bookings.length} reminder(s)...`);

  for (const booking of bookings) {
    const phone = booking.customer?.phone;
    const serviceName = booking.service?.name || 'Услуга';

    if (!phone) {
      console.warn(`[Reminders] Booking ${booking.id} has no phone, skipping.`);
      continue;
    }

    try {
      await sendTextMessage(phone, buildReminderMessage(serviceName, booking.booking_time));

      const { error: updateError } = await supabase
        .from('bookings')
        .update({ reminder_sent: true })
        .eq('id', booking.id);

      if (updateError) throw updateError;

      console.log(`[Reminders] Sent to ${phone} for booking ${booking.id}`);
    } catch (err) {
      console.error(`[Reminders] Failed for booking ${booking.id}:`, err.message);
      // Don't mark as sent — will retry on next interval
    }
  }
}

async function sendFollowUpReminders() {
  const now = new Date();
  const windowStart = new Date(now.getTime() - FOLLOWUP_MAX_DAYS * DAY_MS);
  const windowEnd = new Date(now.getTime() - FOLLOWUP_MIN_DAYS * DAY_MS);

  let bookings;
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('id, booking_time, followup_reminder_sent_at, customer:customers(phone, name)')
      .eq('status', 'confirmed')
      .is('followup_reminder_sent_at', null)
      .gte('booking_time', windowStart.toISOString())
      .lt('booking_time', windowEnd.toISOString())
      .order('booking_time', { ascending: false });

    if (error) throw error;
    bookings = data || [];
  } catch (err) {
    console.error('[FollowUpReminders] Failed to fetch bookings:', err.message);
    return;
  }

  if (!bookings.length) return;

  const latestByCustomer = new Map();
  for (const booking of bookings) {
    const phone = booking.customer?.phone;
    if (!phone) continue;

    const key = phone.replace(/\D/g, '');
    if (!latestByCustomer.has(key)) {
      latestByCustomer.set(key, booking);
    }
  }

  const candidates = [...latestByCustomer.values()];
  if (!candidates.length) return;

  console.log(`[FollowUpReminders] Sending ${candidates.length} reminder(s)...`);

  for (const booking of candidates) {
    const phone = booking.customer?.phone;

    if (!phone) {
      console.warn(`[FollowUpReminders] Booking ${booking.id} has no phone, skipping.`);
      continue;
    }

    try {
      await sendTrackedClientPrompt(phone, formatFollowUpPrompt(), 'book_appointment');

      const { error: updateError } = await supabase
        .from('bookings')
        .update({ followup_reminder_sent_at: new Date().toISOString() })
        .eq('id', booking.id);

      if (updateError) throw updateError;

      console.log(`[FollowUpReminders] Sent to ${phone} for booking ${booking.id}`);
    } catch (err) {
      console.error(`[FollowUpReminders] Failed for booking ${booking.id}:`, err.message);
    }
  }
}

async function runReminderJobs() {
  await sendReminders();
  await sendFollowUpReminders();
}

function startReminderScheduler() {
  console.log(
    `[Reminders] Scheduler started — checking every ${REMINDER_INTERVAL_MS / 60_000} min, ` +
    `lead time: ${REMINDER_LEAD_MINUTES} min, follow-up window: ${FOLLOWUP_MIN_DAYS}-${FOLLOWUP_MAX_DAYS} days.`
  );

  // Run immediately on startup, then on each interval
  runReminderJobs();
  setInterval(runReminderJobs, REMINDER_INTERVAL_MS);
}

module.exports = { startReminderScheduler };
