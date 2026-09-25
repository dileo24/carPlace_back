const { Conversacion, Mensaje } = require("../../../db");
const { getIO } = require("../../../bot/socket");
const { uploadMediaToCloudinary } = require("../../../services/cloudinaryService");
const { limpiarSeguimiento7Dias } = require("../../../services/limpiarSeguimiento7Dias");
const { limpiarEsperandoConfirmacionVisita } = require("../../../services/limpiarEsperandoConfirmacionVisita");
const streamifier = require("streamifier");
const axios = require("axios");
const FormData = require("form-data");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const { PassThrough } = require("stream");
ffmpeg.setFfmpegPath(ffmpegPath);

const convertirBufferAMp3 = inputBuffer => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const output = new PassThrough();
    output.on("data", chunk => chunks.push(chunk));
    output.on("end", () => resolve(Buffer.concat(chunks)));
    output.on("error", reject);

    ffmpeg()
      .input(streamifier.createReadStream(inputBuffer))
      .audioCodec("libmp3lame")
      .audioBitrate(128)
      .format("mp3")
      .on("error", reject)
      .pipe(output, { end: true });
  });
};

const enviarAudio = async (req, res) => {
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

    // ── Chequeo de permisos, ANTES de tocar ffmpeg/Cloudinary ──
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
    if (!buffer) return res.status(400).json({ status: 400, error: "No se recibió audio" });

    // 1. Re-encodear con ffmpeg para garantizar MP3 válido
    let mp3Buffer;
    try {
      mp3Buffer = await convertirBufferAMp3(buffer);
      console.log(`🎵 Re-encoded MP3: ${mp3Buffer.length} bytes`);
    } catch (e) {
      console.warn("⚠️ ffmpeg falló, usando buffer original:", e.message);
      mp3Buffer = buffer;
    }
    if (!mp3Buffer || mp3Buffer.length === 0) {
      console.warn("⚠️ mp3Buffer vacío, usando buffer original");
      mp3Buffer = buffer;
    }

    if (!mp3Buffer || mp3Buffer.length === 0) {
      return res.status(400).json({ status: 400, error: "Audio vacío o inválido" });
    }

    // 2. Subir a Cloudinary para mostrarlo en el CRM
    const uploadResult = await uploadMediaToCloudinary(mp3Buffer, "general", "video");
    const cloudinaryUrl = uploadResult.secure_url;
    const cloudinaryPublicId = uploadResult.public_id;

    // 3. Subir a Meta y enviar por WhatsApp
    if (conv.canal === "WhatsApp" && conv.waContactId) {
      try {
        const form = new FormData();
        form.append("messaging_product", "whatsapp");
        form.append("type", "audio/mpeg");
        form.append("file", mp3Buffer, {
          filename: "audio.mp3",
          contentType: "audio/mpeg",
          knownLength: mp3Buffer.length,
        });

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

        await axios.post(
          `https://graph.facebook.com/v19.0/${process.env.WA_PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: conv.waContactId,
            type: "audio",
            audio: { id: waMediaId },
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          },
        );
      } catch (e) {
        console.warn("⚠️ No se pudo enviar audio por WhatsApp:", e.message);
      }
    }

    // 4. Guardar en BD
    const mensaje = await Mensaje.create({
      conversacionId: conv.id,
      tipo: "saliente",
      autor: "asesor",
      texto: "[audio]",
      mediaUrl: cloudinaryUrl,
      mediaType: "audio",
      mediaPublicId: cloudinaryPublicId,
      mediaResourceType: "video",
      userId: userId ? Number(userId) : null,
      autorNombre,
      timestamp: new Date(),
    });

    await conv.update({
      ultimoMensaje: "[audio]",
      ultimaActividad: new Date(),
      adminNoLeido: true,
    });

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
          texto: "[audio]",
          mediaUrl: cloudinaryUrl,
          mediaType: "audio",
          timestamp: mensaje.timestamp,
        },
        ultimoMensaje: "[audio]",
        ultimaActividad: new Date(),
      });
    } catch (_) {}

    return res.status(201).json({ status: 201, resp: mensaje });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = enviarAudio;
