const OpenAI = require('openai');
const { supabase } = require('./supabase');
const { sendTextMessage, sendImageMessage, reuploadMedia } = require('./whatsapp');

const sessions = new Map();

const STATES = {
  MENU: 'menu',
  BOOKING_CATEGORY: 'booking_category',
  BOOKING_SERVICE: 'booking_service',
  BOOKING_DAY: 'booking_day',
  BOOKING_SLOT: 'booking_slot',
  MY_BOOKINGS_LIST: 'my_bookings_list',
  MY_BOOKINGS_ACTION: 'my_bookings_action',
  CANCEL_CONFIRM: 'cancel_confirm',
  RESCHEDULE_DAY: 'reschedule_day',
  RESCHEDULE_SLOT: 'reschedule_slot',
  HELP_MESSAGE: 'help_message',
  PHOTO_SELFIE: 'photo_selfie',
  PHOTO_REFERENCE: 'photo_reference',
};

const WORKING_HOURS_START = parseInt(process.env.WORKING_HOURS_START || '10', 10);
const WORKING_HOURS_END = parseInt(process.env.WORKING_HOURS_END || '21', 10);
const SLOT_STEP_MINUTES = parseInt(process.env.SLOT_STEP_MINUTES || '30', 10);
const BOOKING_DAYS_AHEAD = parseInt(process.env.BOOKING_DAYS_AHEAD || '7', 10);
const MIN_LEAD_MINUTES = parseInt(process.env.MIN_LEAD_MINUTES || '30', 10);

const ADMIN_PHONES = (process.env.ADMIN_PHONES || '')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean)
  .map(normalizePhone);

const ADMIN_REPLY_TTL_MS = 24 * 60 * 60 * 1000;
const adminReplyTargets = new Map();

const GLOBAL_MENU_COMMANDS = ['меню', 'menu', 'старт', 'start', 'главное меню', 'в меню'];
const HELP_COMMANDS = ['помощь', 'help', '?'];

function getTimezone() {
  return process.env.TIMEZONE || 'Asia/Almaty';
}

function normalizePhone(phone) {
  return String(phone).replace(/\D/g, '');
}

function getSession(phone) {
  const key = normalizePhone(phone);
  if (!sessions.has(key)) {
    sessions.set(key, { state: STATES.MENU });
  }
  return sessions.get(key);
}

function resetSession(phone) {
  const key = normalizePhone(phone);
  sessions.set(key, { state: STATES.MENU });
}

function matchesChoice(text, options) {
  const normalized = text.trim().toLowerCase();
  return options.some((option) => normalized === option.toLowerCase());
}

function isAdminPhone(phone) {
  return ADMIN_PHONES.includes(normalizePhone(phone));
}

function pruneAdminReplyTargets() {
  const now = Date.now();

  for (const [messageId, target] of adminReplyTargets.entries()) {
    if (now - target.createdAt > ADMIN_REPLY_TTL_MS) {
      adminReplyTargets.delete(messageId);
    }
  }
}

function trackAdminReplyTarget(messageId, clientPhone, flow) {
  if (!messageId) return;

  adminReplyTargets.set(messageId, {
    clientPhone: normalizePhone(clientPhone),
    flow,
    createdAt: Date.now(),
  });

  pruneAdminReplyTargets();
}

function getAdminReplyTarget(messageId) {
  if (!messageId) return null;

  const target = adminReplyTargets.get(messageId);
  if (!target) return null;

  if (Date.now() - target.createdAt > ADMIN_REPLY_TTL_MS) {
    adminReplyTargets.delete(messageId);
    return null;
  }

  return target;
}

function formatBarberReply(text) {
  return `💈 Ответ барбера:\n\n${text}`;
}

// ---------- formatting helpers ----------

function formatPrice(price) {
  return Number(price).toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

function formatTime(date) {
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: getTimezone(),
    hour: '2-digit',
    minute: '2-digit',
  });
  return formatter.format(date);
}

function formatDateShort(date) {
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: getTimezone(),
    day: 'numeric',
    month: 'long',
  });
  return formatter.format(date);
}

function formatDateTimeFull(isoOrDate) {
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: getTimezone(),
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
  return formatter.format(date);
}

function formatDayLabel(dayOffset) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);

  if (dayOffset === 0) return `Сегодня (${formatDateShort(date)})`;
  if (dayOffset === 1) return `Завтра (${formatDateShort(date)})`;

  const weekday = new Intl.DateTimeFormat('ru-RU', {
    timeZone: getTimezone(),
    weekday: 'long',
  }).format(date);

  return `${capitalize(weekday)} (${formatDateShort(date)})`;
}

function buildMenuMessage({ showGreeting = false, hideServicesOption = false } = {}) {
  const greeting = showGreeting ? 'Здравствуйте! Добро пожаловать в Brabus Barbershop! 💈\n📍 Адрес: Астана, Бокейхана 27/2\n2ГИС: https://2gis.kz/astana/geo/70000001083498136\n\n' : '';
  const items = [];
  if (!hideServicesOption) {
    items.push('1. Услуги и цены');
  }
  items.push('2. Записаться', '3. Мои записи', '4. Помощь', '5. Оценка прически');

  return `${greeting}Выберите действие:

${items.join('\n')}

Напишите номер или то, что вам нужно.`;
}

function buildHelpMessage() {
  return `ℹ️ Как пользоваться ботом:

• «Услуги и цены» — посмотреть прайс-лист
• «Записаться» — выбрать услугу, день и время
• «Мои записи» — посмотреть, перенести или отменить запись

✍️ Напишите ваш вопрос или сообщение прямо сейчас. Барбер ответит вам прямо в этом чате (или отправьте «0» для возврата в меню):`;
}

function formatServicesList(allServices) {
  if (!allServices.length) {
    return `Услуги пока не добавлены. Обратитесь к администратору.\n\n${buildMenuMessage()}`;
  }

  const individual = allServices.filter((s) => s.category === 'individual');
  const complex = allServices.filter((s) => s.category === 'complex');
  const lines = [];

  if (individual.length) {
    lines.push('✂️ Индивидуальные услуги:');
    individual.forEach((s) => {
      lines.push(`• ${s.name} — ${formatDuration(s.duration_minutes)}, ${formatPrice(s.price)} ₸`);
    });
  }

  if (complex.length) {
    if (lines.length) lines.push('');
    lines.push('👨‍👦 Комплексные услуги:');
    complex.forEach((s) => {
      lines.push(`• ${s.name} — ${formatDuration(s.duration_minutes)}, ${formatPrice(s.price)} ₸`);
    });
  }

  return `Наши услуги:\n\n${lines.join('\n')}\n\n${buildMenuMessage({ hideServicesOption: true })}`;
}

function formatCategoryMenu() {
  return `Какие услуги вас интересуют?

1. Индивидуальные услуги
2. Комплексные услуги (для нескольких человек)

0. Назад в меню`;
}

function formatServicesForBooking(services) {
  const lines = services.map(
    (s, i) => `${i + 1}. ${s.name} — ${formatDuration(s.duration_minutes)}, ${formatPrice(s.price)} ₸`
  );
  return `Выберите услугу (напишите номер):\n\n${lines.join('\n')}\n\n0. Назад`;
}

function formatDaysList() {
  const lines = [];
  for (let i = 0; i < BOOKING_DAYS_AHEAD; i += 1) {
    lines.push(`${i + 1}. ${formatDayLabel(i)}`);
  }
  return `На какой день записать?\n\n${lines.join('\n')}\n\n0. Назад`;
}

function formatSlotsList(slots) {
  if (!slots.length) {
    return `На этот день свободного времени нет.\n\n${formatDaysList()}`;
  }
  const lines = slots.map((s, i) => `${i + 1}. ${s.label}`);
  return `Свободное время:\n\n${lines.join('\n')}\n\nНапишите номер времени.\n\n0. Назад`;
}

function formatBookingConfirmation(serviceName, bookingTimeIso) {
  return `✅ Вы записаны!

Услуга: ${serviceName}
Время: ${formatDateTimeFull(bookingTimeIso)}
📍 Адрес: Астана, Бокейхана 27/2
2ГИС: https://2gis.kz/astana/geo/70000001083498136

Чтобы посмотреть, перенести или отменить запись — напишите «Мои записи».

${buildMenuMessage()}`;
}

function formatMyBookingsList(bookings) {
  const lines = bookings.map((b, i) => {
    const serviceName = b.service?.name || 'Услуга';
    return `${i + 1}. ${serviceName} — ${formatDateTimeFull(b.booking_time)}`;
  });
  return `Ваши записи:\n\n${lines.join('\n')}\n\n📍 Адрес: Астана, Бокейхана 27/2\n2ГИС: https://2gis.kz/astana/geo/70000001083498136\n\nНапишите номер записи, чтобы отменить или перенести её.\n\n0. В меню`;
}

function formatBookingActionMenu(booking) {
  const serviceName = booking.service?.name || 'Услуга';
  return `Запись: ${serviceName}
Время: ${formatDateTimeFull(booking.booking_time)}
📍 Адрес: Астана, Бокейхана 27/2
2ГИС: https://2gis.kz/astana/geo/70000001083498136

1. Отменить запись
2. Перенести запись
3. Назад к списку

0. В меню`;
}

function formatCancelConfirm(booking) {
  return `Вы уверены, что хотите отменить запись на ${formatDateTimeFull(booking.booking_time)}?

1. Да, отменить
2. Нет, назад`;
}

// ---------- data access ----------

async function getOrCreateCustomer(phone, name) {
  const normalizedPhone = normalizePhone(phone);

  const { data: existing, error: findError } = await supabase
    .from('customers')
    .select('id, phone, name')
    .eq('phone', normalizedPhone)
    .maybeSingle();

  if (findError) throw findError;
  if (existing) return existing;

  const { data: created, error: createError } = await supabase
    .from('customers')
    .insert({ phone: normalizedPhone, name: name || null })
    .select('id, phone, name')
    .single();

  if (createError) throw createError;
  return created;
}

async function getServices() {
  const { data, error } = await supabase
    .from('services')
    .select('id, name, category, duration_minutes, price')
    .eq('is_active', true)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getServicesByCategory(category) {
  const { data, error } = await supabase
    .from('services')
    .select('id, name, category, duration_minutes, price')
    .eq('category', category)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getOccupiedIntervals(dayStart, dayEnd, excludeBookingId) {
  let query = supabase
    .from('bookings')
    .select('id, booking_time, duration_minutes')
    .eq('status', 'confirmed')
    .gte('booking_time', dayStart.toISOString())
    .lt('booking_time', dayEnd.toISOString());

  if (excludeBookingId) {
    query = query.neq('id', excludeBookingId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row) => {
    const start = new Date(row.booking_time);
    const end = new Date(start.getTime() + row.duration_minutes * 60000);
    return { start, end };
  });
}

async function getAvailableSlotsForDay(dayOffset, durationMinutes, excludeBookingId) {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  dayStart.setDate(dayStart.getDate() + dayOffset);

  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const occupied = await getOccupiedIntervals(dayStart, dayEnd, excludeBookingId);
  const now = new Date();
  const earliestToday = new Date(now.getTime() + MIN_LEAD_MINUTES * 60000);

  const slots = [];
  const openMinutes = WORKING_HOURS_START * 60;
  const closeMinutes = WORKING_HOURS_END * 60;

  for (
    let startMin = openMinutes;
    startMin + durationMinutes <= closeMinutes;
    startMin += SLOT_STEP_MINUTES
  ) {
    const slotStart = new Date(dayStart);
    slotStart.setMinutes(startMin);
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);

    if (dayOffset === 0 && slotStart < earliestToday) continue;

    const overlaps = occupied.some(
      (interval) => slotStart < interval.end && slotEnd > interval.start
    );
    if (overlaps) continue;

    slots.push({ iso: slotStart.toISOString(), label: formatTime(slotStart) });
  }

  return slots;
}

async function getMyUpcomingBookings(customerId) {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, booking_time, duration_minutes, service:services(name, price)')
    .eq('customer_id', customerId)
    .eq('status', 'confirmed')
    .gte('booking_time', new Date().toISOString())
    .order('booking_time', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function createBooking(customerId, serviceId, bookingTimeIso, durationMinutes) {
  const { data, error } = await supabase
    .from('bookings')
    .insert({
      customer_id: customerId,
      service_id: serviceId,
      booking_time: bookingTimeIso,
      duration_minutes: durationMinutes,
      status: 'confirmed',
    })
    .select('id, booking_time')
    .single();

  if (error) {
    if (error.code === '23505' || error.code === '23P01') {
      return { error: 'Этот слот уже занят. Выберите другое время.' };
    }
    throw error;
  }

  return { data };
}

async function cancelBooking(bookingId) {
  const { error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', bookingId)
    .eq('status', 'confirmed');

  if (error) throw error;
}

async function rescheduleBooking(bookingId, newTimeIso) {
  const { data, error } = await supabase
    .from('bookings')
    .update({ booking_time: newTimeIso })
    .eq('id', bookingId)
    .eq('status', 'confirmed')
    .select('id, booking_time')
    .single();

  if (error) {
    if (error.code === '23505' || error.code === '23P01') {
      return { error: 'Этот слот уже занят. Выберите другое время.' };
    }
    throw error;
  }

  return { data };
}

async function notifyAdmins(message) {
  if (!ADMIN_PHONES.length) return;
  await Promise.all(
    ADMIN_PHONES.map(async (phone) => {
      try {
        await sendTextMessage(phone, message);
      } catch (err) {
        console.error(`Failed to notify admin ${phone}:`, err.message);
      }
    })
  );
}

function extractSentMessageId(result) {
  return result?.messages?.[0]?.id || null;
}

// ---------- intent detection ----------

async function detectIntent(message) {
  if (!process.env.OPENAI_API_KEY) return null;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Ты определяешь намерение клиента барбершопа. Ответь JSON: {"intent":"..."}.
Допустимые intent:
- view_services — хочет посмотреть услуги или цены
- book_appointment — хочет записаться, спрашивает про свободное время
- my_bookings — спрашивает про свою существующую запись, хочет её посмотреть, перенести или отменить
- help — просит о помощи, хочет связаться с администратором или задать вопрос
- menu — приветствие или непонятный запрос
Не выполняй запись, только классифицируй.`,
        },
        { role: 'user', content: message },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    const allowed = ['view_services', 'book_appointment', 'my_bookings', 'menu', 'help'];
    return allowed.includes(parsed.intent) ? parsed.intent : 'menu';
  } catch (err) {
    console.error('OpenAI intent detection failed:', err.message);
    return null;
  }
}

function parseMenuChoice(text) {
  if (matchesChoice(text, ['1', 'услуги', 'услуги и цены', 'цены', 'прайс'])) {
    return 'view_services';
  }
  if (matchesChoice(text, ['2', 'записаться', 'запись'])) {
    return 'book_appointment';
  }
  if (matchesChoice(text, ['3', 'мои записи', 'мои запись', 'записи'])) {
    return 'my_bookings';
  }
  if (matchesChoice(text, ['4', 'помощь', 'help', '?'])) {
    return 'help';
  }
  if (matchesChoice(text, ['5', 'оценка прически', 'фото', 'прическа'])) {
    return 'photo_review';
  }
  return null;
}

// ---------- flow: view services ----------

async function handleViewServices() {
  const services = await getServices();
  return formatServicesList(services);
}

// ---------- flow: booking ----------

function startBookingFlow(session) {
  session.state = STATES.BOOKING_CATEGORY;
  return formatCategoryMenu();
}

async function handleBookingCategoryChoice(phone, session, text) {
  if (text === '0') {
    resetSession(phone);
    return buildMenuMessage();
  }

  let category = null;
  if (matchesChoice(text, ['1', 'индивидуальные', 'индивидуальные услуги'])) category = 'individual';
  if (matchesChoice(text, ['2', 'комплексные', 'комплексные услуги'])) category = 'complex';

  if (!category) {
    return `Пожалуйста, выберите 1 или 2.\n\n${formatCategoryMenu()}`;
  }

  const services = await getServicesByCategory(category);
  if (!services.length) {
    return `В этой категории сейчас нет доступных услуг.\n\n${formatCategoryMenu()}`;
  }

  session.category = category;
  session.services = services;
  session.state = STATES.BOOKING_SERVICE;
  return formatServicesForBooking(services);
}

async function handleBookingServiceChoice(phone, session, text) {
  if (text === '0') {
    session.state = STATES.BOOKING_CATEGORY;
    return formatCategoryMenu();
  }

  const index = parseInt(text, 10) - 1;
  const service = session.services?.[index];

  if (!service) {
    return `Выберите номер услуги из списка.\n\n${formatServicesForBooking(session.services || [])}`;
  }

  session.serviceId = service.id;
  session.serviceName = service.name;
  session.serviceDuration = service.duration_minutes;
  session.state = STATES.BOOKING_DAY;
  return formatDaysList();
}

async function handleBookingDayChoice(phone, session, text) {
  if (text === '0') {
    session.state = STATES.BOOKING_SERVICE;
    return formatServicesForBooking(session.services || []);
  }

  const dayOffset = parseInt(text, 10) - 1;
  if (Number.isNaN(dayOffset) || dayOffset < 0 || dayOffset >= BOOKING_DAYS_AHEAD) {
    return `Пожалуйста, выберите день из списка.\n\n${formatDaysList()}`;
  }

  const slots = await getAvailableSlotsForDay(dayOffset, session.serviceDuration);
  if (!slots.length) {
    return `На этот день свободного времени нет. Выберите другой день.\n\n${formatDaysList()}`;
  }

  session.dayOffset = dayOffset;
  session.slots = slots;
  session.state = STATES.BOOKING_SLOT;
  return formatSlotsList(slots);
}

async function handleBookingSlotChoice(phone, session, customerId, text) {
  if (text === '0') {
    session.state = STATES.BOOKING_DAY;
    return formatDaysList();
  }

  const index = parseInt(text, 10) - 1;
  const slot = session.slots?.[index];

  if (!slot) {
    return `Выберите номер времени из списка.\n\n${formatSlotsList(session.slots || [])}`;
  }

  const result = await createBooking(customerId, session.serviceId, slot.iso, session.serviceDuration);

  if (result.error) {
    session.slots = await getAvailableSlotsForDay(session.dayOffset, session.serviceDuration);
    if (!session.slots.length) {
      resetSession(phone);
      return `${result.error}\n\nК сожалению, на этот день больше нет свободного времени.\n\n${buildMenuMessage()}`;
    }
    return `${result.error}\n\n${formatSlotsList(session.slots)}`;
  }

  const serviceName = session.serviceName;
  resetSession(phone);

  notifyAdmins(`🆕 Новая запись\nУслуга: ${serviceName}\nВремя: ${formatDateTimeFull(slot.iso)}`);

  return formatBookingConfirmation(serviceName, slot.iso);
}

// ---------- flow: my bookings ----------

async function handleMyBookingsRequest(phone, session, customerId) {
  const bookings = await getMyUpcomingBookings(customerId);

  if (!bookings.length) {
    resetSession(phone);
    return `У вас пока нет активных записей.\n\n${buildMenuMessage()}`;
  }

  session.myBookings = bookings;
  session.state = STATES.MY_BOOKINGS_LIST;
  return formatMyBookingsList(bookings);
}

async function handleMyBookingsListChoice(phone, session, text) {
  if (text === '0') {
    resetSession(phone);
    return buildMenuMessage();
  }

  const index = parseInt(text, 10) - 1;
  const booking = session.myBookings?.[index];

  if (!booking) {
    return `Выберите номер записи из списка.\n\n${formatMyBookingsList(session.myBookings || [])}`;
  }

  session.selectedBooking = booking;
  session.state = STATES.MY_BOOKINGS_ACTION;
  return formatBookingActionMenu(booking);
}

async function handleMyBookingsActionChoice(phone, session, text) {
  if (text === '0') {
    resetSession(phone);
    return buildMenuMessage();
  }

  if (matchesChoice(text, ['3', 'назад'])) {
    session.state = STATES.MY_BOOKINGS_LIST;
    return formatMyBookingsList(session.myBookings || []);
  }

  if (matchesChoice(text, ['1', 'отменить', 'отменить запись'])) {
    session.state = STATES.CANCEL_CONFIRM;
    return formatCancelConfirm(session.selectedBooking);
  }

  if (matchesChoice(text, ['2', 'перенести', 'перенести запись'])) {
    session.state = STATES.RESCHEDULE_DAY;
    return formatDaysList();
  }

  return `Пожалуйста, выберите вариант из списка.\n\n${formatBookingActionMenu(session.selectedBooking)}`;
}

async function handleCancelConfirmChoice(phone, session, text) {
  if (matchesChoice(text, ['2', 'нет', '0'])) {
    session.state = STATES.MY_BOOKINGS_ACTION;
    return formatBookingActionMenu(session.selectedBooking);
  }

  if (matchesChoice(text, ['1', 'да'])) {
    const booking = session.selectedBooking;
    await cancelBooking(booking.id);
    resetSession(phone);

    notifyAdmins(
      `❌ Отмена записи\nУслуга: ${booking.service?.name || ''}\nВремя: ${formatDateTimeFull(booking.booking_time)}`
    );

    return `Запись отменена.\n\n${buildMenuMessage()}`;
  }

  return `Пожалуйста, ответьте «Да» или «Нет».\n\n${formatCancelConfirm(session.selectedBooking)}`;
}

async function handleRescheduleDayChoice(phone, session, text) {
  if (text === '0') {
    session.state = STATES.MY_BOOKINGS_ACTION;
    return formatBookingActionMenu(session.selectedBooking);
  }

  const dayOffset = parseInt(text, 10) - 1;
  if (Number.isNaN(dayOffset) || dayOffset < 0 || dayOffset >= BOOKING_DAYS_AHEAD) {
    return `Пожалуйста, выберите день из списка.\n\n${formatDaysList()}`;
  }

  const booking = session.selectedBooking;
  const slots = await getAvailableSlotsForDay(dayOffset, booking.duration_minutes, booking.id);

  if (!slots.length) {
    return `На этот день свободного времени нет. Выберите другой день.\n\n${formatDaysList()}`;
  }

  session.dayOffset = dayOffset;
  session.slots = slots;
  session.state = STATES.RESCHEDULE_SLOT;
  return formatSlotsList(slots);
}

async function handleRescheduleSlotChoice(phone, session, text) {
  if (text === '0') {
    session.state = STATES.RESCHEDULE_DAY;
    return formatDaysList();
  }

  const index = parseInt(text, 10) - 1;
  const slot = session.slots?.[index];

  if (!slot) {
    return `Выберите номер времени из списка.\n\n${formatSlotsList(session.slots || [])}`;
  }

  const booking = session.selectedBooking;
  const result = await rescheduleBooking(booking.id, slot.iso);

  if (result.error) {
    session.slots = await getAvailableSlotsForDay(session.dayOffset, booking.duration_minutes, booking.id);
    if (!session.slots.length) {
      resetSession(phone);
      return `${result.error}\n\nК сожалению, на этот день больше нет свободного времени.\n\n${buildMenuMessage()}`;
    }
    return `${result.error}\n\n${formatSlotsList(session.slots)}`;
  }

  const serviceName = booking.service?.name || 'Услуга';
  resetSession(phone);

  notifyAdmins(`🔁 Перенос записи\nУслуга: ${serviceName}\nНовое время: ${formatDateTimeFull(slot.iso)}`);

  return `✅ Запись перенесена на ${formatDateTimeFull(slot.iso)}.\n📍 Адрес: Астана, Бокейхана 27/2\n2ГИС: https://2gis.kz/astana/geo/70000001083498136\n\n${buildMenuMessage()}`;
}

// ---------- flow: help ----------

function startHelpFlow(session) {
  session.state = STATES.HELP_MESSAGE;
  return buildHelpMessage();
}

async function handleHelpMessageSubmit(phone, session, text, customer) {
  if (text === '0') {
    resetSession(phone);
    return buildMenuMessage();
  }

  const nameLabel = customer.name ? `${customer.name} ` : '';
  const adminMsg = `📩 Новое сообщение от клиента!
Имя: ${nameLabel}(+${phone})
Телефон: +${phone}

Текст:
${text}`;

  await Promise.all(
    ADMIN_PHONES.map(async (adminPhone) => {
      try {
        const result = await sendTextMessage(adminPhone, adminMsg);
        trackAdminReplyTarget(extractSentMessageId(result), phone, 'help');
      } catch (err) {
        console.error(`Failed to notify admin ${adminPhone}:`, err.message);
      }
    })
  );

  resetSession(phone);
  return `✅ Ваше сообщение отправлено барберу. Ответ придёт прямо в этот чат.\n\n${buildMenuMessage()}`;
}

// ---------- flow: photo review ----------

function startPhotoReviewFlow(session) {
  session.state = STATES.PHOTO_SELFIE;
  session.selfieMediaId = null;
  session.selfieMediaMime = null;
  return `📸 Оценка прически

Шаг 1 из 2 — отправьте ваше фото (как вы выглядите сейчас).

0. Назад в меню`;
}

async function handlePhotoSelfie(phone, session, mediaId, mimeType) {
  if (!mediaId) {
    return `Пожалуйста, отправьте фотографию (не текст).\n\n0. Назад в меню`;
  }

  session.selfieMediaId = mediaId;
  session.selfieMediaMime = mimeType || 'image/jpeg';
  session.state = STATES.PHOTO_REFERENCE;
  return `Точно, фото получено! 👍\n\nШаг 2 из 2 — теперь отправьте референс (желаемая прическа).\n\n0. Назад в меню`;
}

async function handlePhotoReference(phone, session, customer, mediaId, mimeType) {
  if (!mediaId) {
    return `Пожалуйста, отправьте фото-референс (не текст).\n\n0. Назад в меню`;
  }

  const selfieId = session.selfieMediaId;
  const selfMime = session.selfieMediaMime || 'image/jpeg';
  const refMime = mimeType || 'image/jpeg';
  const nameLabel = customer.name ? ` (${customer.name})` : '';

  resetSession(phone);

  // Forward both photos to every admin asynchronously — don't block the reply
  (async () => {
    try {
      // Re-upload both images so admins can receive them
      const [selfieNewId, refNewId] = await Promise.all([
        reuploadMedia(selfieId, selfMime),
        reuploadMedia(mediaId, refMime),
      ]);

      const intro = `📸 Запрос оценки прически
Клиент${nameLabel}: +${phone}`;

      await Promise.all(
        ADMIN_PHONES.map(async (adminPhone) => {
          try {
            const introResult = await sendTextMessage(adminPhone, intro);
            trackAdminReplyTarget(extractSentMessageId(introResult), phone, 'photo_review');

            const selfieResult = await sendImageMessage(adminPhone, selfieNewId, '🧑 Фото клиента');
            trackAdminReplyTarget(extractSentMessageId(selfieResult), phone, 'photo_review');

            const refResult = await sendImageMessage(adminPhone, refNewId, '💇 Референс');
            trackAdminReplyTarget(extractSentMessageId(refResult), phone, 'photo_review');
          } catch (err) {
            console.error(`[PhotoReview] Failed to notify admin ${adminPhone}:`, err.message);
          }
        })
      );
    } catch (err) {
      console.error('[PhotoReview] Failed to forward photos:', err.message);
    }
  })();

  return `✅ Оба фото отправлены барберу!

Мастер рассмотрит ваши фото и ответит вам прямо в этом чате — ожидайте ответа в ближайшее время.

${buildMenuMessage()}`;
}

// ---------- main dispatcher ----------

async function handleIncomingMessage({
  phone,
  text,
  contactName,
  mediaId = null,
  mimeType = null,
  messageId = null,
  replyToMessageId = null,
}) {
  const trimmed = (text || '').trim();
  const lower = trimmed.toLowerCase();
  const normalizedPhone = normalizePhone(phone);

  if (isAdminPhone(normalizedPhone)) {
    if (!replyToMessageId) {
      console.log(`[AdminRelay] Ignored non-reply admin message from ${normalizedPhone}`);
      return null;
    }

    const target = getAdminReplyTarget(replyToMessageId);

    if (!target) {
      console.warn(
        `[AdminRelay] No tracked client found for admin reply ${normalizedPhone} -> ${replyToMessageId}`
      );
      return null;
    }

    if (!trimmed) {
      console.warn(
        `[AdminRelay] Empty admin reply ignored for ${normalizedPhone} -> ${replyToMessageId}`
      );
      return null;
    }

    try {
      await sendTextMessage(target.clientPhone, formatBarberReply(trimmed));
      console.log(
        `[AdminRelay] Relayed admin reply from ${normalizedPhone} to ${target.clientPhone}`
      );
    } catch (err) {
      console.error(
        `[AdminRelay] Failed to relay admin reply from ${normalizedPhone} to ${target.clientPhone}:`,
        err.message
      );
    }

    return null;
  }

  const customer = await getOrCreateCustomer(phone, contactName);
  const session = getSession(phone);

  if (GLOBAL_MENU_COMMANDS.includes(lower)) {
    resetSession(phone);
    return buildMenuMessage({ showGreeting: lower === 'start' || lower === 'старт' });
  }

  if (HELP_COMMANDS.includes(lower)) {
    return startHelpFlow(session);
  }

  switch (session.state) {
    case STATES.BOOKING_CATEGORY:
      return handleBookingCategoryChoice(phone, session, trimmed);
    case STATES.BOOKING_SERVICE:
      return handleBookingServiceChoice(phone, session, trimmed);
    case STATES.BOOKING_DAY:
      return handleBookingDayChoice(phone, session, trimmed);
    case STATES.BOOKING_SLOT:
      return handleBookingSlotChoice(phone, session, customer.id, trimmed);
    case STATES.MY_BOOKINGS_LIST:
      return handleMyBookingsListChoice(phone, session, trimmed);
    case STATES.MY_BOOKINGS_ACTION:
      return handleMyBookingsActionChoice(phone, session, trimmed);
    case STATES.CANCEL_CONFIRM:
      return handleCancelConfirmChoice(phone, session, trimmed);
    case STATES.RESCHEDULE_DAY:
      return handleRescheduleDayChoice(phone, session, trimmed);
    case STATES.RESCHEDULE_SLOT:
      return handleRescheduleSlotChoice(phone, session, trimmed);
    case STATES.HELP_MESSAGE:
      return handleHelpMessageSubmit(phone, session, trimmed, customer);
    case STATES.PHOTO_SELFIE:
      if (trimmed === '0') { resetSession(phone); return buildMenuMessage(); }
      return handlePhotoSelfie(phone, session, mediaId, mimeType);
    case STATES.PHOTO_REFERENCE:
      if (trimmed === '0') { resetSession(phone); return buildMenuMessage(); }
      return handlePhotoReference(phone, session, customer, mediaId, mimeType);
    default:
      break;
  }

  let action = parseMenuChoice(trimmed);

  if (!action) {
    const intent = await detectIntent(trimmed);
    if (intent) action = intent;
  }

  if (action === 'view_services') {
    return handleViewServices();
  }

  if (action === 'book_appointment') {
    return startBookingFlow(session);
  }

  if (action === 'my_bookings') {
    return handleMyBookingsRequest(phone, session, customer.id);
  }

  if (action === 'help') {
    return startHelpFlow(session);
  }

  if (action === 'photo_review') {
    return startPhotoReviewFlow(session);
  }

  return buildMenuMessage({ showGreeting: true });
}

module.exports = {
  handleIncomingMessage,
  buildMenuMessage,
};
