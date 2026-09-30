const { Op } = require("sequelize");
const { Conversacion, Mensaje, EventoCalendario } = require("../../../db");
const { sendWhatsAppTemplate } = require("../../../services/whatsapp");
const { getIO } = require("../../../bot/socket");
const { variantesTelefono } = require("../../../services/consultasHelper");
const normalizarTelefono = require("../../../services/normalizarTelefono");
const { backfillNotasConversacion } = require("../../../services/backfillNotasConversacion");

const ROLES_CON_ACCESO = ["admin", "supervisor", "publicador_vendedor"];

// Vincula el evento de calendario del que salió el pedido (si vino de uno)
// con la conversación resultante, para que "ver chat" no vuelva a quedar
// apuntando a nada la próxima vez que se abra ese evento.
async function linkearEvento(eventoId, conversacionId) {
  if (!eventoId) return;
  try {
    const evento = await EventoCalendario.findByPk(eventoId);
    if (evento && !evento.conversacionId) {
      await evento.update({ conversacionId });
      try {
        getIO().emit("calendario:actualizado");
      } catch (_) {}
    }
  } catch (_) {}
}

const iniciarConversacion = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    if (!ROLES_CON_ACCESO.includes(rol)) {
      return res
        .status(403)
        .json({ status: 403, error: "Sin permiso para iniciar conversaciones" });
    }
    const { telefono: telefonoRaw, nombre, apellido, consultaId, vehiculo, eventoId } = req.body;

    if (!telefonoRaw) {
      return res.status(400).json({ status: 400, error: "El teléfono es requerido" });
    }

    const telefono = normalizarTelefono(telefonoRaw);
    const variantes = variantesTelefono(telefono);

    // Si ya existe una conversación con este número, no duplicar
    const convExistente = await Conversacion.findOne({
      where: { telefono: { [Op.in]: variantes } },
    });

    if (convExistente) {
      if (consultaId && !convExistente.consultaId) {
        await convExistente.update({ consultaId });
        try {
          await backfillNotasConversacion(convExistente.id, consultaId);
        } catch (_) {}
        try {
          getIO().emit("conversacion:actualizada", {
            conversacionId: convExistente.id,
            consultaId,
          });
        } catch (_) {}
      }
      await linkearEvento(eventoId, convExistente.id);
      return res.status(200).json({
        status: 200,
        resp: convExistente,
        mensaje: "Ya existe una conversación con este número.",
      });
    }

    const nombreCliente = nombre || "cliente";
    const tituloConsulta = vehiculo || "tu consulta reciente";

    let waResp;
    try {
      waResp = await sendWhatsAppTemplate(telefono, "aviso_consulta_admin", [
        {
          type: "body",
          parameters: [
            { type: "text", parameter_name: "nombre", text: nombreCliente },
            { type: "text", parameter_name: "titulo_consulta", text: tituloConsulta },
          ],
        },
      ]);
    } catch (err) {
      const codigoMeta = err.response?.data?.error?.code;
      const templateNoAprobado = codigoMeta === 132001 || codigoMeta === 132000;

      console.error(
        "❌ Error enviando template inicial:",
        err.response?.data?.error?.message || err.message,
      );

      return res.status(502).json({
        status: 502,
        error: templateNoAprobado
          ? "La plantilla de WhatsApp para iniciar conversaciones todavía está en revisión de Meta. Probá de nuevo más tarde."
          : "No se pudo enviar el mensaje de WhatsApp. Verificá el número o intentá nuevamente.",
        templateNoAprobado,
      });
    }
    if (!waResp) {
      console.error("❌ No se pudo enviar el template: configuración de WhatsApp incompleta");
      return res.status(502).json({
        status: 502,
        error:
          "El servicio de WhatsApp no está configurado correctamente. Contactá al equipo técnico.",
      });
    }

    const waMsgId = waResp?.messages?.[0]?.id || null;
    const textoMensaje = `Hola ${nombreCliente}! Nos comunicamos de Car Place respecto a su consulta sobre ${tituloConsulta}. Quedamos a su disposición para cualquier información adicional que necesite.`;

    const conv = await Conversacion.create({
      telefono,
      waContactId: telefono,
      canal: "WhatsApp",
      estado: "asesor",
      contactoNombre: nombre || null,
      contactoApellido: apellido || null,
      consultaId: consultaId || null,
      ultimoMensaje: textoMensaje,
      ultimaActividad: new Date(),
    });

    const mensajeCreado = await Mensaje.create({
      conversacionId: conv.id,
      tipo: "saliente",
      autor: "bot",
      texto: textoMensaje,
      waMsgId,
      timestamp: new Date(),
    });

    if (consultaId) {
      try {
        await backfillNotasConversacion(conv.id, consultaId);
      } catch (_) {}
    }

    const convConMensaje = { ...conv.toJSON(), mensajes: [mensajeCreado.toJSON()] };

    try {
      getIO().emit("conversacion:nueva", { conversacion: convConMensaje });
    } catch (_) {}

    await linkearEvento(eventoId, conv.id);

    return res.status(201).json({ status: 201, resp: convConMensaje });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = iniciarConversacion;
