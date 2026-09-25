const { Conversacion, Mensaje } = require("../../../db");
const { sendWhatsAppMessage } = require("../../../services/whatsapp"); // ← agregar
const { getIO } = require("../../../bot/socket");
const { limpiarSeguimiento7Dias } = require("../../../services/limpiarSeguimiento7Dias");
const { limpiarEsperandoConfirmacionVisita } = require("../../../services/limpiarEsperandoConfirmacionVisita");
const ROLES_FULL = ["admin", "supervisor"];

const enviarMensaje = async (req, res) => {
  try {
    const { texto } = req.body;
    if (!texto?.trim())
      return res.status(400).json({ status: 400, error: "El texto es requerido" });

    const userId = req.user?.id ?? null;
    const rol = req.user?.rol || "";

    const nombre = req.user?.nombre || "";
    const apellido = req.user?.apellido || "";
    let autorNombre = [nombre, apellido].filter(Boolean).join(" ").trim() || null;

    if (!autorNombre && userId) {
      try {
        const { User } = require("../../../db");
        const record = await User.findByPk(Number(userId)).catch(() => null);
        if (record) {
          const n = record.nombre || record.name || "";
          const a = record.apellido || "";
          autorNombre = [n, a].filter(Boolean).join(" ").trim() || null;
        }
      } catch (_) {}
    }

    const conv = await Conversacion.findByPk(req.params.id);
    if (!conv) return res.status(404).json({ status: 404, error: "Conversación no encontrada" });
    if (conv.estado === "cerrada")
      return res.status(400).json({ status: 400, error: "La conversación está cerrada" });

    const esFull = ROLES_FULL.includes(rol);
    const esDueño = conv.estado === "asesor" && String(conv.asesorId) === String(userId);
    if (!esFull && !esDueño) {
      return res.status(403).json({ status: 403, error: "No podés responder esta conversación" });
    }

    // El primero que responde se queda con la conversación: si todavía está
    // libre (nadie la tomó), este mensaje la toma automáticamente para quien
    // lo manda — mismo criterio que tomarConversacion.js, incluyendo el
    // update atómico condicionado a que siga libre para evitar que dos
    // respuestas casi simultáneas queden ambas "asignadas". Si ya tiene un
    // asesor asignado, NUNCA se reasigna acá — aunque después responda un
    // admin/supervisor (que puede escribir en cualquier conversación por
    // ROLES_FULL), la conversación sigue a nombre de quien la tomó primero.
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

    let waMsgIdSaliente = null;
    if (conv.canal === "WhatsApp" && conv.waContactId) {
      const waResp = await sendWhatsAppMessage(conv.waContactId, texto.trim());
      waMsgIdSaliente = waResp?.messages?.[0]?.id || null;
    }

    const mensaje = await Mensaje.create({
      conversacionId: conv.id,
      tipo: "saliente",
      autor: "asesor",
      texto: texto.trim(),
      userId: userId ? Number(userId) : null,
      autorNombre,
      waMsgId: waMsgIdSaliente,
      timestamp: new Date(),
    });

    await conv.update({
      ultimoMensaje: texto.trim(),
      ultimaActividad: new Date(),
      adminNoLeido: true,
    });

    try {
      await limpiarSeguimiento7Dias(conv.id);
    } catch (_) {}

    try {
      await limpiarEsperandoConfirmacionVisita(conv.id);
    } catch (_) {}

    // Emitir por socket para que el frontend se actualice en tiempo real
    try {
      getIO().emit("conversacion:mensaje", {
        conversacionId: conv.id,
        mensaje: {
          id: mensaje.id,
          tipo: "saliente",
          autor: "asesor",
          autorNombre,
          texto: texto.trim(),
          timestamp: mensaje.timestamp,
          waMsgId: waMsgIdSaliente || null,
        },
        ultimoMensaje: texto.trim(),
        ultimaActividad: new Date(),
        adminNoLeido: true,
      });
    } catch (_) {}

    return res.status(201).json({ status: 201, resp: mensaje });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = enviarMensaje;
