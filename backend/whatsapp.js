const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';

function getConfig() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error('WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required');
  }

  return { token, phoneNumberId };
}

async function sendTextMessage(to, text) {
  const { token, phoneNumberId } = getConfig();

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  };

  console.log('SENDING PAYLOAD TO META:', JSON.stringify(payload, null, 2));

  const response = await fetch(
    `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error('WhatsApp API error:', data);
    throw new Error(data.error?.message || 'Failed to send WhatsApp message');
  }

  return data;
}

/**
 * Send an image to a WhatsApp recipient using an already-uploaded media_id.
 * caption is optional.
 */
async function sendImageMessage(to, mediaId, caption = '') {
  const { token, phoneNumberId } = getConfig();

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'image',
    image: { id: mediaId, ...(caption ? { caption } : {}) },
  };

  const response = await fetch(
    `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error('WhatsApp sendImage API error:', data);
    throw new Error(data.error?.message || 'Failed to send WhatsApp image');
  }

  return data;
}

/**
 * Fetch the temporary download URL for a media object from Meta.
 */
async function getMediaUrl(mediaId) {
  const { token } = getConfig();

  const response = await fetch(
    `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${mediaId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || 'Failed to get media URL');
  }

  return data.url; // temporary URL, valid ~5 minutes
}

/**
 * Download raw media bytes from a Meta temporary URL.
 */
async function downloadMedia(url) {
  const { token } = getConfig();

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.status}`);
  }

  return response; // caller can call .buffer() / .arrayBuffer()
}

/**
 * Upload a media buffer to the WhatsApp Business phone and return the new media_id.
 * mimeType should match the original (e.g. 'image/jpeg').
 */
async function uploadMedia(buffer, mimeType, filename) {
  const { token, phoneNumberId } = getConfig();

  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('type', mimeType);
  formData.append('file', new Blob([buffer], { type: mimeType }), filename);

  const response = await fetch(
    `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/media`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || 'Failed to upload media');
  }

  return data.id; // new media_id suitable for sending
}

/**
 * Re-upload a media object (by its incoming media_id) so it can be sent to other recipients.
 * Returns a new media_id owned by our phone number.
 */
async function reuploadMedia(mediaId, mimeType) {
  const url = await getMediaUrl(mediaId);
  const dlResponse = await downloadMedia(url);
  const buffer = Buffer.from(await dlResponse.arrayBuffer());
  const ext = mimeType.split('/')[1] || 'jpg';
  return uploadMedia(buffer, mimeType, `photo.${ext}`);
}

function verifyWebhook(mode, token, challenge) {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (!verifyToken) {
    throw new Error('WHATSAPP_VERIFY_TOKEN is required');
  }

  if (mode === 'subscribe' && token === verifyToken) {
    return challenge;
  }

  return null;
}

function extractIncomingMessages(body) {
  const messages = [];

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value?.messages) continue;

      for (const message of value.messages) {
        const contact = (value.contacts || []).find((c) => c.wa_id === message.from);
        const base = {
          from: message.from,
          messageId: message.id,
          contactName: contact?.profile?.name || null,
          type: message.type,
        };

        if (message.type === 'text') {
          messages.push({ ...base, text: message.text.body.trim() });
        } else if (message.type === 'image') {
          messages.push({
            ...base,
            text: null,
            mediaId: message.image.id,
            mimeType: message.image.mime_type || 'image/jpeg',
            caption: message.image.caption || '',
          });
        }
        // other types (audio, video, etc.) are silently ignored
      }
    }
  }

  return messages;
}

module.exports = {
  sendTextMessage,
  sendImageMessage,
  getMediaUrl,
  downloadMedia,
  uploadMedia,
  reuploadMedia,
  verifyWebhook,
  extractIncomingMessages,
};
