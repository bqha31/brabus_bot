# Brabus — WhatsApp-бот для барбершопа (MVP)

Минимальный бот для записи клиентов через WhatsApp Cloud API с хранением данных в Supabase.

## Стек

- **Supabase** — PostgreSQL
- **Node.js + Express** — webhook-сервер
- **WhatsApp Cloud API** — сообщения
- **OpenAI** (опционально) — определение намерения по тексту

## Структура

```
backend/
  server.js          — Express-сервер и webhook
  whatsapp.js        — отправка сообщений, парсинг webhook
  supabase.js        — клиент Supabase
  bookingService.js  — услуги, слоты, записи, AI intent
sql/
  schema.sql         — таблицы
  seed.sql           — тестовые услуги
.env.example
```

## Быстрый старт (сегодня)

### 1. Supabase

1. Создайте проект на [supabase.com](https://supabase.com)
2. Откройте **SQL Editor** → **New query**
3. Выполните `sql/schema.sql`, затем `sql/seed.sql`
4. В **Project Settings → API** скопируйте:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (не anon key)

Проверка: в **Table Editor** должны появиться таблицы `services`, `customers`, `bookings` и 3 услуги.

### 2. WhatsApp Cloud API (Meta)

1. Зайдите в [developers.facebook.com](https://developers.facebook.com)
2. Создайте приложение типа **Business** → добавьте продукт **WhatsApp**
3. В **WhatsApp → API Setup** получите:
   - **Temporary access token** (или permanent через System User)
   - **Phone number ID**
4. Добавьте свой номер в **To** (тестовые получатели), пока приложение не опубликовано
5. Придумайте свой **Verify Token** (любая строка, например `brabus_verify_2026`)

### 3. Локальный сервер

```bash
cp .env.example .env
# заполните .env своими значениями

npm install
npm start
```

Сервер запустится на `http://localhost:3000`.

### 4. Публичный URL для webhook (ngrok)

WhatsApp должен достучаться до вашего localhost. Самый быстрый способ — ngrok:

```bash
# установите ngrok: https://ngrok.com/download
ngrok http 3000
```

Скопируйте HTTPS-URL, например: `https://abc123.ngrok-free.app`

### 5. Настройка webhook в Meta

1. **WhatsApp → Configuration → Webhook**
2. **Callback URL:** `https://abc123.ngrok-free.app/webhook`
3. **Verify token:** тот же, что в `.env` → `WHATSAPP_VERIFY_TOKEN`
4. Нажмите **Verify and save**
5. Подпишитесь на поле **messages**

Если verify прошёл — в терминале сервера появится `Webhook verified`.

### 6. Тест

1. Напишите с телефона на WhatsApp-номер бота: `Привет`
2. Бот ответит меню:
   ```
   1. Посмотреть услуги
   2. Записаться
   ```
3. Отправьте `1` — список услуг и цен
4. Отправьте `2` → выберите услугу (номер) → выберите слот (номер)
5. Проверьте запись в Supabase → **Table Editor → bookings**

## Диалог бота

| Шаг | Клиент пишет | Бот отвечает |
|-----|--------------|--------------|
| 1 | Любое сообщение | Меню (услуги / записаться) |
| 2 | `1` | Список услуг с ценами |
| 3 | `2` | Выбор услуги |
| 4 | `1` | Доступные слоты |
| 5 | `1` | Подтверждение записи |

Пример подтверждения:

> Вы успешно записаны на Мужскую стрижку 22 июня в 15:00.

## Доступные слоты (MVP)

Бот показывает фиксированные слоты и скрывает уже занятые:

- Сегодня 15:00, 16:00, 17:00
- Завтра 12:00, 13:00

Прошедшее время за сегодня автоматически не показывается.

## OpenAI (опционально)

Если добавить `OPENAI_API_KEY` в `.env`, бот понимает фразы вроде:

- «Хочу постричься завтра» → начнёт запись
- «Есть время сегодня вечером?» → начнёт запись
- «Сколько стоит стрижка?» → покажет услуги

AI **только определяет намерение**. Запись, слоты и цены — обычный код.

Без ключа OpenAI бот работает через цифры `1` и `2`.

## Переменные окружения

| Переменная | Обязательно | Описание |
|------------|-------------|----------|
| `SUPABASE_URL` | да | URL проекта Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | да | Service role key |
| `WHATSAPP_ACCESS_TOKEN` | да | Token Meta Graph API |
| `WHATSAPP_PHONE_NUMBER_ID` | да | ID номера WhatsApp |
| `WHATSAPP_VERIFY_TOKEN` | да | Строка для verify webhook |
| `PORT` | нет | Порт сервера (по умолчанию 3000) |
| `TIMEZONE` | нет | Часовой пояс (по умолчанию `Asia/Almaty`) |
| `OPENAI_API_KEY` | нет | Ключ OpenAI |
| `OPENAI_MODEL` | нет | Модель (по умолчанию `gpt-4o-mini`) |

## Управление данными

Через **Supabase Dashboard → Table Editor**:

- **services** — услуги и цены
- **customers** — клиенты (создаются автоматически)
- **bookings** — записи (`confirmed` / `cancelled`)

Отменить запись вручную: измените `status` на `cancelled` — слот снова станет доступен.

## Troubleshooting

**Webhook verify failed (403)**  
Проверьте, что `WHATSAPP_VERIFY_TOKEN` в `.env` совпадает с Meta Console и сервер запущен.

**Бот не отвечает**  
- ngrok/tunnel активен и URL актуален  
- В Meta подписано поле `messages`  
- Ваш номер добавлен как тестовый получатель  
- Смотрите логи в терминале (`npm start`)

**Ошибка Supabase**  
- Используйте **service_role** key, не anon  
- Выполнены оба SQL-файла

**Слот уже занят**  
Один слот = одна запись. Выберите другой или отмените старую запись в Supabase.

## Production (позже)

Для продакшена замените temporary token на permanent, задеployte сервер (Railway, Render, Fly.io) и укажите постоянный HTTPS URL в webhook Meta.
