const { Conversacion, Mensaje } = require("../../../db");
const { getIO } = require("../../../bot/socket");
const { uploadMediaToCloudinary } = require("../../../services/cloudinaryService");
const { limpiarSeguimiento7Dias } = require("../../../services/limpiarSeguimiento7Dias");
const { limpiarEsperandoConfirmacionVisita } = require("../../../services/limpiarEsperandoConfirmacionVisita");
const axios = require("axios");
const FormData = require("form-data");
const sharp = require("sharp");

const MIME_CONFIG = {
  // imágenes
  "image/jpeg": { waType: "image", cloudFolder: "crm_media", resource_type: "image" },
  "image/png": { waType: "image", cloudFolder: "crm_media", resource_type: "image" },
  // videos
  "video/mp4": { waType: "video", cloudFolder: "crm_media", resource_type: "video" },
  "video/3gpp": { waType: "video", cloudFolder: "crm_media", resource_type: "video" },
};

const enviarMedia = async (req, res) => {
  try {
    const userId = req.user?.id ?? null;
    const rol = req.user?.rol || "";
    const nombre = req.user?.nombre || "";
    const apellido = req.user?.apellido || "";
    let autorNombre = [nombre, apellido].filter(Boolean).join(" ").trim() || null;

    const conv = await Conversacion.findByPk(req.params.id);
    if (!conv) return res.status(404).json({ status: 404, error: "Conversación no encontrada" });
    if (conv.estado === "cerrada")
      return res.status(400).json({ status: 400, error: "La conversación está cerrada" });

    // ── Chequeo de permisos, ANTES de subir nada a Cloudinary ──
    const ROLES_FULL = ["admin", "supervisor"];
    const esFull = ROLES_FULL.includes(rol);
    const esDueño = conv.estado === "asesor" && String(conv.asesorId) === String(userId);
    if (!esFull && !esDueño) {
      return res.status(403).json({ status: 403, error: "No podés responder esta conversación" });
    }

    // El primero que responde se queda con la conversación — ver el mismo
    // bloque en enviarMensaje.js para el detalle completo del criterio.
    const estabaLibre = conv.estado === "bot" || !conv.asesorId;
    if (estabaLibre && userId) {
      const [afectados] = await Conversacion.update(
        {
          estado: "asesor",
          asesorId: Number(userId),
          asesorNombre: nombre || null,
          asesorApellido: apellido || null,
        },
        { where: { id: conv.id, asesorId: null } },
      );
      if (afectados) {
        conv.set({
          estado: "asesor",
          asesorId: Number(userId),
          asesorNombre: nombre || null,
          asesorApellido: apellido || null,
        });
        try {
          getIO().emit("conversacion:estadoCambiado", {
            conversacionId: conv.id,
            estado: "asesor",
            asesorNombre: nombre || null,
            asesorApellido: apellido || null,
          });
        } catch (_) {}
      }
    }

    if (!autorNombre && userId) {
      try {
        const { User, Admin } = require("../../../db");
        const record =
          (await User.findByPk(Number(userId)).catch(() => null)) ||
          (await Admin.findByPk(Number(userId)).catch(() => null));
        if (record) {
          const n = record.nombre || record.name || "";
          const a = record.apellido || "";
          autorNombre = [n, a].filter(Boolean).join(" ").trim() || null;
        }
      } catch (_) {}
    }

    const buffer = req.file?.buffer;
    const mimeType = req.file?.mimetype;
    if (!buffer) return res.status(400).json({ status: 400, error: "No se recibió archivo" });

    const config = MIME_CONFIG[mimeType];
    if (!config)
      return res
        .status(400)
        .json({ status: 400, error: `Tipo de archivo no soportado: ${mimeType}` });

    // 1. Subir a Cloudinary
    const uploadResult = await uploadMediaToCloudinary(buffer, config.cloudFolder, config.resource_type);
    const mediaUrl = uploadResult.secure_url;
    const mediaPublicId = uploadResult.public_id;

    // 2. Enviar por WhatsApp si aplica
    if (conv.canal === "WhatsApp" && conv.waContactId) {
      // Reintentos con backoff — el admin suele mandar varias fotos seguidas
      // (una cada 5-6s), y eso alcanza a pegarle a algún límite de ráfaga de
      // la API de Meta: antes, un fallo acá se tragaba silenciosamente (solo
      // quedaba en el log) y el mensaje se guardaba igual como "enviado" en
      // el CRM, aunque nunca hubiera llegado al cliente.
      const INTENTOS_ENVIO_WA = 3;
      let ultimoError = null;
      let enviado = false;

      for (let intento = 1; intento <= INTENTOS_ENVIO_WA && !enviado; intento++) {
        try {
          // Comprimir si es imagen y pesa más de 4MB
          let bufferParaWA = buffer;
          let mimeParaWA = mimeType;
          if (config.waType === "image" && buffer.length > 4 * 1024 * 1024) {
            bufferParaWA = await sharp(buffer).jpeg({ quality: 75 }).toBuffer();
            mimeParaWA = "image/jpeg";
          }

          const form = new FormData();
          form.append("file", bufferParaWA, {
            filename: req.file.originalname || `media.${config.waType === "image" ? "jpg" : "mp4"}`,
            contentType: mimeParaWA,
          });
          form.append("messaging_product", "whatsapp");
          form.append("type", mimeParaWA);

          const uploadResp = await axios.post(
            `https://graph.facebook.com/v19.0/${process.env.WA_PHONE_NUMBER_ID}/media`,
            form,
            {
              headers: {
                ...form.getHeaders(),
                Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`,
              },
            },
          );

          const waMediaId = uploadResp.data.id;
          const caption = req.body.caption || "";

          await axios.post(
            `https://graph.facebook.com/v19.0/${process.env.WA_PHONE_NUMBER_ID}/messages`,
            {
              messaging_product: "whatsapp",
              to: conv.waContactId,
              type: config.waType,
              [config.waType]: {
                id: waMediaId,
                ...(caption && { caption }),
              },
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
              },
            },
          );

          enviado = true;
        } catch (e) {
          ultimoError = e;
          console.warn(
            `⚠️ Falló envío de media por WhatsApp (intento ${intento}/${INTENTOS_ENVIO_WA}):`,
            e.message,
          );
          console.warn("Detalle Meta:", e.response?.data ?? e.response?.status ?? "sin response");
          if (intento < INTENTOS_ENVIO_WA) {
            await new Promise(r => setTimeout(r, 1500 * intento));
          }
        }
      }

      // Si tras los reintentos igual falló, no guardamos el mensaje como
      // "enviado" — mejor un error visible en el CRM (que el admin sepa que
      // tiene que reintentar esa foto puntual) que una foto fantasma que el
      // cliente nunca recibió.
      if (!enviado) {
        return res.status(502).json({
          status: 502,
          error: "No se pudo enviar por WhatsApp (Meta rechazó el envío tras varios intentos). Probá de nuevo en unos segundos.",
          detalle: ultimoError?.response?.data ?? ultimoError?.message,
        });
      }
    }

    // 3. Guardar en BD
    const textoMensaje = config.waType === "image" ? "[imagen]" : "[video]";
    const mensaje = await Mensaje.create({
      conversacionId: conv.id,
      tipo: "saliente",
      autor: "asesor",
      texto: textoMensaje,
      mediaUrl,
      mediaType: config.waType,
      mediaPublicId,
      mediaResourceType: config.resource_type,
      userId: userId ? Number(userId) : null,
      autorNombre,
      timestamp: new Date(),
    });

    await conv.update({ ultimoMensaje: textoMensaje, ultimaActividad: new Date(), adminNoLeido: true });

    try {
      await limpiarSeguimiento7Dias(conv.id);
    } catch (_) {}

    try {
      await limpiarEsperandoConfirmacionVisita(conv.id);
    } catch (_) {}

    try {
      getIO().emit("conversacion:mensaje", {
        conversacionId: conv.id,
        mensaje: {
          id: mensaje.id,
          tipo: "saliente",
          autor: "asesor",
          autorNombre,
          texto: textoMensaje,
          mediaUrl,
          mediaType: config.waType,
          timestamp: mensaje.timestamp,
        },
        ultimoMensaje: textoMensaje,
        ultimaActividad: new Date(),
      });
    } catch (_) {}

    return res.status(201).json({ status: 201, resp: mensaje });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = enviarMedia;
