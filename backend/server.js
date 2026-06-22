require('dotenv').config();

if (process.env.TIMEZONE) {
  process.env.TZ = process.env.TIMEZONE;
}

const express = require('express');
const { sendTextMessage, verifyWebhook, extractIncomingMessages } = require('./whatsapp');
const { handleIncomingMessage } = require('./bookingService');
const { startReminderScheduler } = require('./reminderService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'brabus-barbershop-bot' });
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  try {
    const result = verifyWebhook(mode, token, challenge);
    if (result) {
      console.log('Webhook verified');
      return res.status(200).send(result);
    }
    return res.sendStatus(403);
  } catch (err) {
    console.error('Webhook verification error:', err.message);
    return res.sendStatus(500);
  }
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  console.log('RAW FROM WEBHOOK:', JSON.stringify(req.body, null, 2));

  const messages = extractIncomingMessages(req.body);

  for (const message of messages) {
    try {
      console.log(`Message from ${message.from}: type=${message.type} text=${message.text}`);

      const reply = await handleIncomingMessage({
        phone: message.from,
        text: message.text,
        contactName: message.contactName,
        mediaId: message.mediaId || null,
        mimeType: message.mimeType || null,
      });

      if (reply) {
        console.log(`SENDING TO WHATSAPP: ${message.from}`);
        await sendTextMessage(message.from, reply);
      }
    } catch (err) {
      console.error('Error handling message:', err);
      try {
        console.log(`SENDING ERROR REPLY TO WHATSAPP: ${message.from}`);
        await sendTextMessage(
          message.from,
          'Произошла ошибка. Попробуйте ещё раз или напишите «меню».'
        );
      } catch (sendErr) {
        console.error('Failed to send error message:', sendErr);
      }
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
  if (process.env.OPENAI_API_KEY) {
    console.log('OpenAI intent detection: enabled');
  } else {
    console.log('OpenAI intent detection: disabled (bot works via menu numbers)');
  }
  if (process.env.ADMIN_PHONES) {
    console.log(`Admin notifications: enabled (${process.env.ADMIN_PHONES.split(',').length} number(s))`);
  } else {
    console.log('Admin notifications: disabled (set ADMIN_PHONES to enable)');
  }

  startReminderScheduler();
});
