// services/whatsapp.js
const axios = require("axios");

const BASE_URL = "https://graph.facebook.com";
const VERSION = process.env.WA_API_VERSION || "v19.0";
const PHONE_ID = process.env.WA_PHONE_NUMBER_ID;
const TOKEN = process.env.WA_ACCESS_TOKEN;

async function sendWhatsAppMessage(to, body) {
  if (!PHONE_ID || !TOKEN) {
    console.warn("⚠️  WA_PHONE_NUMBER_ID o WA_ACCESS_TOKEN no configurados — mensaje no enviado");
    return null;
  }

  const url = `${BASE_URL}/${VERSION}/${PHONE_ID}/messages`;

  const response = await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body },
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
    },
  );

  return response.data;
}

async function sendWhatsAppTemplate(to, templateName, components = []) {
  if (!PHONE_ID || !TOKEN) {
    console.warn("⚠️  WA_PHONE_NUMBER_ID o WA_ACCESS_TOKEN no configurados — template no enviado");
    return null;
  }

  const url = `${BASE_URL}/${VERSION}/${PHONE_ID}/messages`;

  const response = await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "es_AR" },
        ...(components.length > 0 ? { components } : {}),
      },
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
    },
  );

  return response.data;
}

module.exports = { sendWhatsAppMessage, sendWhatsAppTemplate };
