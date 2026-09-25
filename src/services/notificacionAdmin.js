const { sendWhatsAppMessage, sendWhatsAppTemplate } = require("./whatsapp");

const ADMIN_NUMERO = process.env.ADMIN_WHATSAPP;

async function enviarNotificacion(numero, texto) {
  try {
    await sendWhatsAppTemplate(numero, "notificacion_admin", [
      {
        type: "body",
        parameters: [
          {
            type: "text",
            parameter_name: "notification_text",
            text: texto.replace(/\n/g, " | ").slice(0, 1024),
          },
        ],
      },
    ]);
    console.log(`📣 notificarAdmin → ${numero}: ${texto.slice(0, 80)}...`);
  } catch (err) {
    console.warn(`⚠️ Template falló para ${numero}:`, err.response?.data || err.message);
    try {
      await sendWhatsAppMessage(numero, texto);
      console.log(`📣 notificarAdmin (fallback) → ${numero}: ${texto.slice(0, 80)}...`);
    } catch (err2) {
      console.error(`❌ notificarAdmin error para ${numero}:`, err2.response?.data || err2.message);
    }
  }
}

async function notificarAdmin(texto, otrosNums = []) {
  if (!ADMIN_NUMERO) {
    console.warn("⚠️  notificarAdmin: ADMIN_WHATSAPP no está definido");
    return;
  }

  const destinatarios = [ADMIN_NUMERO, ...otrosNums];
  await Promise.all(destinatarios.map(num => enviarNotificacion(num, texto)));
}

module.exports = { notificarAdmin };
