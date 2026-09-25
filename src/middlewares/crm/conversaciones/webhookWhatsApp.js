const { sendWhatsAppMessage } = require("../../../services/whatsapp");
const { Conversacion, Mensaje } = require("../../../db");
const { getIO } = require("../../../bot/socket");
const {
  procesarMediaDesdeBuffer,
  transcribirAudio,
  downloadMedia,
  getMediaUrl,
} = require("../../../services/mediaWhatsApp");
const procesarMensaje = require("../../../bot/procesarMensaje");
const { enriquecerTextoConUrl } = require("../../../services/extraerContenidoUrl");
const normalizarTelefono = require("../../../services/normalizarTelefono");
const {
  procesarAudioAdmin,
  procesarRespuestaAdmin,
  esAudioDeAdmin,
  esMensajeDeAdmin,
} = require("../../../bot/procesarComandoVoz");

const verify = (req, res) => {
  const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook de WhatsApp verificado");
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ error: "Token inválido" });
};

const timers = {};
const mensajesBuffer = {};
const procesando = new Set();

// ── Ejecutar bot ───────────────────────────────────────────────────────────────
async function ejecutarBot(conv, from, textosCombinados, mensajesGuardados) {
  const esMediaSinTexto =
    !textosCombinados ||
    textosCombinados.trim() === "" ||
    /^\[(imagen|foto|video|sticker|documento)\]$/i.test(textosCombinados.trim());

  if (esMediaSinTexto) {
    console.log(`📷 Conv ${conv.id}: media sin texto, sin respuesta del bot`);
    return;
  }

  // Se toma el lock ANTES de cualquier await — si se tomara después (como
  // estaba antes, recién al final de la notificación al admin), un segundo
  // mensaje casi simultáneo del mismo contacto podía llegar mientras el
  // primer findByPk todavía estaba en vuelo, ver procesando.has() en false, y
  // arrancar su propio procesamiento en paralelo en vez de encolarse.
  procesando.add(conv.id);

  // Notificar al admin si la conv está en modo asesor
  try {
    const convActualizada = await Conversacion.findByPk(conv.id);

    // Ignorar mensajes del número de prueba
    const telefonoLimpio = from.replace(/\D/g, "");
    const esPrueba = telefonoLimpio.endsWith("3516863857");

    if (!esPrueba && convActualizada?.estado === "asesor") {
      const nombre = convActualizada.contactoNombre || conv.telefono;
      const { notificarAdmin } = require("../../../services/notificacionAdmin");
      notificarAdmin(
        `💬 Nuevo mensaje de ${nombre}\n${textosCombinados.slice(0, 300)}`,
      ).catch(() => {});
    }
  } catch (e) {
    console.warn(`⚠️ Error verificando estado conv ${conv.id}:`, e.message);
  }

  try {
    await Promise.all(mensajesGuardados.map(m => m.update({ procesado: true })));
  } catch (e) {
    console.warn(`⚠️ No se pudieron marcar mensajes como procesados (inicio):`, e.message);
  }
  try {
    const textoEnriquecido = await enriquecerTextoConUrl(textosCombinados);
    if (textoEnriquecido !== textosCombinados) {
      console.log(`🔗 Texto enriquecido con URL para conv ${conv.id}`);
    }
    const respuesta = await procesarMensaje(conv.id, textoEnriquecido);
    if (respuesta) {
      console.log(`Bot respondió conv ${conv.id}: ${respuesta.slice(0, 80)}`);
      const waResp = await sendWhatsAppMessage(from, respuesta);
      const waMsgIdBot = waResp?.messages?.[0]?.id || null;
      if (waMsgIdBot) {
        const mensajeAActualizar = await Mensaje.findOne({
          where: { conversacionId: conv.id, autor: "bot", waMsgId: null },
          order: [["timestamp", "DESC"]],
        });
        if (mensajeAActualizar) {
          await mensajeAActualizar.update({ waMsgId: waMsgIdBot });
        }
      }
    } else {
      console.log(`Bot sin respuesta para conv ${conv.id} (derivada o ignorada)`);
    }
  } catch (err) {
    console.error(`❌ Error procesando mensaje con bot conv ${conv.id}:`, err.message);
    try {
      await sendWhatsAppMessage(
        from,
        "Perdoná, tuve un problema técnico. Un asesor te va a contactar enseguida.",
      );
      console.log(`🆘 Fallback enviado a ${from}`);
    } catch (e2) {
      console.error(`❌ No se pudo enviar fallback a ${from}:`, e2.message);
    }
  } finally {
    procesando.delete(conv.id);
    if (mensajesBuffer[conv.id]?.length) {
      console.log(`🔄 Conv ${conv.id}: procesando mensajes encolados tras finalizar`);
      const pendientes = mensajesBuffer[conv.id];
      delete mensajesBuffer[conv.id];
      const textosPendientes = pendientes.map(p => p.texto).join("\n");
      const mensajesPendientes = pendientes.map(p => p.mensaje);
      await ejecutarBot(conv, from, textosPendientes, mensajesPendientes);
    }
  }
}

const receive = async (req, res) => {
  res.status(200).send("OK");

  try {
    const body = req.body;
    if (body.object !== "whatsapp_business_account") return;

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];
    const contacto = value?.contacts?.[0];

    if (!msg) {
      const statuses = value?.statuses;
      if (!statuses) console.log("📭 Webhook sin mensaje ni status, ignorado");
      return;
    }

    const from = msg.from;
    const waMsgId = msg.id;
    const tipo = msg.type;
    // WhatsApp manda el momento real de envío del mensaje (epoch en segundos).
    // Usamos ese valor como timestamp en vez de `new Date()` — si lo tomáramos
    // recién al guardar en BD, quedaría corrido por el tiempo de descarga de
    // media/transcripción de audio (líneas más abajo), que es asíncrono y de
    // duración variable: dos fotos mandadas casi juntas podrían terminar de
    // procesarse en orden distinto al que llegaron, y quedar con timestamps
    // desordenados o iguales entre sí.
    const waTimestamp = msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date();

    console.log(`📨 Webhook recibido: ${from} [${tipo}] id=${waMsgId}`);

    if (!from || !waMsgId || !tipo) {
      console.warn("⚠️ Webhook con campos faltantes:", { from, waMsgId, tipo });
      return;
    }

    if (esAudioDeAdmin(from, tipo)) {
      console.log(`🎙️ Audio del admin detectado (${from}) — procesando comando de voz`);
      procesarAudioAdmin(msg, from).catch(err =>
        console.error("❌ procesarAudioAdmin background:", err.message),
      );
      return;
    }

    if (esMensajeDeAdmin(from, tipo)) {
      const textoAdmin = msg.text?.body || "";
      console.log(`💬 Texto del admin (${from}): ${textoAdmin.slice(0, 60)}`);
      procesarRespuestaAdmin(textoAdmin, msg, from).catch(err =>
        console.error("❌ procesarRespuestaAdmin background:", err.message),
      );
      return;
    }

    let texto = null;
    let mediaId = null;
    let mediaType = null;
    let referenciadoMsgId = msg.context?.id || null;

    if (tipo === "text") {
      texto = msg.text?.body;
      if (!texto) {
        console.warn(`⚠️ Mensaje de texto sin body: ${waMsgId}`);
        return;
      }
    } else if (tipo === "image") {
      texto = msg.image?.caption || "[imagen]";
      mediaId = msg.image?.id;
      mediaType = "image";
    } else if (tipo === "video") {
      texto = msg.video?.caption || "[video]";
      mediaId = msg.video?.id;
      mediaType = "video";
    } else if (tipo === "audio" || tipo === "voice") {
      mediaId = msg.audio?.id || msg.voice?.id;
      mediaType = "audio";
    } else if (tipo === "document") {
      texto = msg.document?.filename || "[documento]";
      mediaId = msg.document?.id;
      mediaType = "documento";
    } else {
      console.log(`📭 Tipo de mensaje no soportado: ${tipo} — body completo:`, JSON.stringify(msg));
      return;
    }

    let mediaUrl = null;
    let mediaPublicId = null;
    let mediaResourceType = null;
    if (mediaId) {
      try {
        console.log(`📥 Descargando media ${mediaType} id=${mediaId}`);
        const tempUrl = await getMediaUrl(mediaId);
        const buffer = await downloadMedia(tempUrl);

        if (mediaType === "audio") {
          try {
            texto = await transcribirAudio(buffer);
            console.log(`🎙️ Transcripción: ${texto?.slice(0, 80)}`);
          } catch (e) {
            console.warn(`⚠️ No se pudo transcribir audio ${waMsgId}:`, e.message);
            texto = "[audio - no se pudo transcribir]";
          }
        }

        try {
          const subida = await procesarMediaDesdeBuffer(buffer, mediaType);
          mediaUrl = subida.url;
          mediaPublicId = subida.publicId;
          mediaResourceType = subida.resourceType;
          console.log(`☁️ Media subida a Cloudinary: ${mediaUrl?.slice(0, 60)}`);
        } catch (e) {
          console.warn(`⚠️ No se pudo subir media a Cloudinary ${waMsgId}:`, e.message);
        }
      } catch (e) {
        console.error(`❌ Error procesando media ${mediaId}:`, e.message);
        if (mediaType === "audio") texto = "[audio - no se pudo procesar]";
      }
    }

    if (!texto) {
      console.warn(`⚠️ Mensaje ${waMsgId} sin texto tras procesamiento, ignorado`);
      return;
    }

    const esPosibleCodigoMeta = /\b\d{6}\b/.test(texto);
    if (esPosibleCodigoMeta) {
      const { notificarAdmin } = require("../../../services/notificacionAdmin");
      notificarAdmin(`🔐 Posible código de verificación recibido en el bot:\n${texto}`).catch(
        () => {},
      );
    }

    try {
      const yaProcessado = await Mensaje.findOne({ where: { waMsgId } });
      if (yaProcessado) {
        console.log(`⚠️ Mensaje duplicado ignorado: ${waMsgId}`);
        return;
      }
    } catch (e) {
      console.error(`❌ Error verificando duplicado ${waMsgId}:`, e.message);
      return;
    }

    console.log(`📩 Procesando mensaje de ${from} [${tipo}]: ${texto.slice(0, 80)}`);

    let conv;
    try {
      // Meta no es consistente con el formato de "from" para números móviles
      // argentinos — a veces manda el "9" después del código de país y a veces
      // no, incluso para el mismo contacto dentro de la misma conversación. Si
      // buscamos con el valor crudo, un cambio de formato entre mensajes hace
      // que no encontremos la conversación ya existente y se cree una nueva
      // (quedando duplicada, aunque con el mismo teléfono ya normalizado). Por
      // eso normalizamos ANTES de buscar, con la misma clave que se usa al crear.
      const telefonoNormalizado = normalizarTelefono(from) || from;
      conv = await Conversacion.findOne({ where: { telefono: telefonoNormalizado } });
      if (!conv) {
        conv = await Conversacion.create({
          telefono: telefonoNormalizado,
          waContactId: from,
          canal: "WhatsApp",
          estado: "bot",
          contactoNombre: contacto?.profile?.name || null,
          ultimaActividad: new Date(),
        });
        console.log(`🆕 Nueva conversación creada: id=${conv.id} para ${from}`);
        try {
          getIO().emit("conversacion:nueva", { conversacion: conv.toJSON() });
        } catch (_) {}
      } else if (conv.estado === "cerrada") {
        await conv.update({ estado: "bot" });
        console.log(`🔄 Conversación ${conv.id} reabierta (estaba cerrada)`);
        try {
          getIO().emit("conversacion:actualizada", { conversacionId: conv.id, estado: "bot" });
        } catch (_) {}
      }
    } catch (e) {
      console.error(`❌ Error buscando/creando conversación para ${from}:`, e.message);
      return;
    }
    const { buscarConsultaActiva } = require("../../../services/consultasHelper");

    // ── Vincular consulta activa existente si la conversación no tiene una ──
    if (!conv.consultaId) {
      try {
        const consultaActiva = await buscarConsultaActiva(from);
        if (consultaActiva) {
          await conv.update({
            consultaId: consultaActiva.id,
            contactoNombre: conv.contactoNombre || consultaActiva.nombre,
            contactoApellido: conv.contactoApellido || consultaActiva.apellido,
          });
          console.log(`🔗 Conv ${conv.id} vinculada a consulta existente #${consultaActiva.id}`);
          try {
            const { backfillNotasConversacion } = require("../../../services/backfillNotasConversacion");
            await backfillNotasConversacion(conv.id, consultaActiva.id);
          } catch (_) {}
          try {
            getIO().emit("conversacion:actualizada", {
              conversacionId: conv.id,
              consultaId: consultaActiva.id,
            });
          } catch (_) {}
        }
      } catch (e) {
        console.warn(`⚠️ Error buscando consulta activa para vincular conv ${conv.id}:`, e.message);
      }
    }
    let mensajeGuardado;
    try {
      mensajeGuardado = await Mensaje.create({
        conversacionId: conv.id,
        tipo: "entrante",
        autor: "contacto",
        texto,
        mediaUrl: mediaUrl || null,
        mediaType: mediaType || null,
        mediaPublicId,
        mediaResourceType,
        waMsgId,
        referenciadoMsgId,
        procesado: false,
        timestamp: waTimestamp,
      });
    } catch (e) {
      console.error(`❌ Error guardando mensaje ${waMsgId} en BD:`, e.message);
      return;
    }

    // Mientras esperamos que el bot clasifique la respuesta al seguimiento de 7
    // días, todavía no sabemos si este mensaje va a quedar oculto para el
    // vendedor para siempre — no adelantamos "último mensaje"/hora de actividad
    // hasta que procesarMensaje.js resuelva el desenlace (mismo criterio ahí,
    // con "ocultarSeguimiento"). Si no hacemos esto, aunque el mensaje quede
    // oculto en el chat, la lista de conversaciones le sigue mostrando al
    // vendedor "hace X min" y hace que el chat suba de posición.
    const esperandoClasificacion7Dias = conv.esperandoRespuestaSeguimiento7Dias === true;
    let noLeidoActualizado = conv.noLeido || 0;
    try {
      if (esperandoClasificacion7Dias) {
        await conv.update({ adminNoLeido: true });
      } else {
        noLeidoActualizado = (conv.noLeido || 0) + 1;
        await conv.update({
          ultimoMensaje: texto,
          ultimaActividad: new Date(),
          noLeido: noLeidoActualizado,
          adminNoLeido: true,
        });
      }
    } catch (e) {
      console.warn(`⚠️ No se pudo actualizar conv ${conv.id}:`, e.message);
    }

    try {
      getIO().emit("conversacion:mensaje", {
        conversacionId: conv.id,
        mensaje: {
          id: mensajeGuardado.id,
          tipo: "entrante",
          autor: "contacto",
          texto,
          mediaUrl: mediaUrl || null,
          mediaType: mediaType || null,
          timestamp: mensajeGuardado.timestamp,
          referenciadoMsgId: referenciadoMsgId || null,
          waMsgId: waMsgId || null,
        },
        ultimoMensaje: esperandoClasificacion7Dias ? conv.ultimoMensaje : texto,
        ultimaActividad: esperandoClasificacion7Dias ? conv.ultimaActividad : new Date(),
        noLeido: noLeidoActualizado,
        adminNoLeido: true,
      });
    } catch (e) {
      console.error(`❌ Error emitiendo socket conv ${conv.id}:`, e.message);
    }

    // ── Buffer + timer con lock ───────────────────────────────────────────────
    if (!mensajesBuffer[conv.id]) mensajesBuffer[conv.id] = [];

    if (procesando.has(conv.id)) {
      // Bot ocupado procesando — encolar el mensaje y esperar
      mensajesBuffer[conv.id].push({ texto, mensaje: mensajeGuardado });
      console.log(
        `⏳ Conv ${conv.id} en proceso, mensaje encolado (${mensajesBuffer[conv.id].length} pendientes)`,
      );
      // Cancelar timer existente si lo hay (el finally de ejecutarBot lo va a disparar)
      if (timers[conv.id]) {
        clearTimeout(timers[conv.id]);
        delete timers[conv.id];
      }
      return;
    }

    mensajesBuffer[conv.id].push({ texto, mensaje: mensajeGuardado });

    if (timers[conv.id]) clearTimeout(timers[conv.id]);

    timers[conv.id] = setTimeout(async () => {
      delete timers[conv.id];
      const pendientes = mensajesBuffer[conv.id] || [];
      delete mensajesBuffer[conv.id];
      const textosCombinados = pendientes.map(p => p.texto).join("\n");
      const mensajesAMarcar = pendientes.map(p => p.mensaje);
      await ejecutarBot(conv, from, textosCombinados, mensajesAMarcar);
    }, 10000);
  } catch (err) {
    console.error("❌ Error crítico en webhook WhatsApp:", err.message, err.stack);
  }
};

module.exports = { verify, receive, procesando, timers, mensajesBuffer, ejecutarBot };
