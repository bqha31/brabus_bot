/**
 * reminderService.js
 *
 * Sends WhatsApp reminders to customers with upcoming bookings.
 * Runs on a configurable interval (default: every 10 minutes).
 *
 * Env variables:
 *   REMINDER_LEAD_MINUTES    — how many minutes before the booking to send (default: 120)
 *   REMINDER_WINDOW_MINUTES  — how wide the look-ahead window is (default: 15)
 *   REMINDER_INTERVAL_MS     — how often the job runs in ms (default: 600000 = 10 min)
 */

const { supabase } = require('./supabase');
const { sendTextMessage } = require('./whatsapp');

const REMINDER_LEAD_MINUTES = parseInt(process.env.REMINDER_LEAD_MINUTES || '120', 10);
const REMINDER_WINDOW_MINUTES = parseInt(process.env.REMINDER_WINDOW_MINUTES || '15', 10);
const REMINDER_INTERVAL_MS = parseInt(process.env.REMINDER_INTERVAL_MS || '600000', 10);

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

function startReminderScheduler() {
  console.log(
    `[Reminders] Scheduler started — checking every ${REMINDER_INTERVAL_MS / 60_000} min, ` +
    `lead time: ${REMINDER_LEAD_MINUTES} min.`
  );

  // Run immediately on startup, then on each interval
  sendReminders();
  setInterval(sendReminders, REMINDER_INTERVAL_MS);
}

module.exports = { startReminderScheduler };
