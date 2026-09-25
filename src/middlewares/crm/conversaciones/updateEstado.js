const { Conversacion, Consulta, ConsultaHistorial } = require("../../../db");
const { getIO } = require("../../../bot/socket");
const { ESTADOS_ACTIVOS } = require("../../../services/consultasHelper");
const { limpiarEsperandoConfirmacionVisita } = require("../../../services/limpiarEsperandoConfirmacionVisita");

const ROLES_VENDEDOR = ["vendedor", "publicador_vendedor"]; // ideal: importar desde un constants.js compartido con getConversaciones.js

const TRANSICIONES_PERMITIDAS = {
  // desde       →  a qué estados puede ir
  bot: ["asesor", "cerrada"],
  asesor: ["bot", "cerrada"],
  cerrada: ["asesor"],
};

const ESTADO_LABEL_CONSULTA = {
  nuevo: "Nuevo",
  con_oferta: "Con oferta",
  seguimiento: "Seguimiento",
  cerrado: "Cerrado",
  perdido: "Perdido",
};

const updateEstado = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    const userId = req.user?.id ?? null;
    const nombre = req.user?.nombre || "";
    const apellido = req.user?.apellido || "";

    const { estado: nuevoEstado, estadoConsulta } = req.body;
    const conv = await Conversacion.findByPk(req.params.id);

    if (!conv) return res.status(404).json({ status: 404, error: "Conversación no encontrada" });

    // Validar transición
    const permitidas = TRANSICIONES_PERMITIDAS[conv.estado] || [];
    if (!permitidas.includes(nuevoEstado)) {
      return res.status(400).json({
        status: 400,
        error: `No se puede pasar de '${conv.estado}' a '${nuevoEstado}'`,
      });
    }

    // Si se cierra el chat y tiene una consulta activa vinculada, hay que
    // decidir con qué desenlace queda esa consulta (nunca queda "colgada" en
    // un estado activo con el chat ya cerrado) — se lo exigimos al frontend
    // ANTES de tocar nada, para no dejar el chat cerrado con la consulta sin
    // resolver si esta validación fallara después del conv.update.
    let consultaVinculada = null;
    if (nuevoEstado === "cerrada" && conv.consultaId) {
      consultaVinculada = await Consulta.findByPk(conv.consultaId);
      if (consultaVinculada && ESTADOS_ACTIVOS.includes(consultaVinculada.estado)) {
        if (!["cerrado", "perdido"].includes(estadoConsulta)) {
          return res.status(400).json({
            status: 400,
            error:
              "Esta conversación tiene una consulta activa vinculada — indicá si se " +
              "cerró (venta concretada) o se perdió antes de cerrar el chat.",
            requiereEstadoConsulta: true,
          });
        }
      } else {
        consultaVinculada = null; // ya estaba cerrada/perdida, no hay nada que sincronizar
      }
    }

    // Vendedor solo puede tomar control de convs en estado "bot", no cerrar
    if (ROLES_VENDEDOR.includes(rol)) {
      if (nuevoEstado !== "asesor") {
        return res.status(403).json({ status: 403, error: "Sin permiso para esta acción" });
      }
      // Y solo si no tiene ya un asesor distinto
      if (conv.asesorId && String(conv.asesorId) !== String(userId)) {
        return res
          .status(403)
          .json({ status: 403, error: "Esta conversación ya la tiene otro asesor" });
      }
    }

    const updates = { estado: nuevoEstado };

    if (nuevoEstado === "asesor") {
      updates.asesorId = userId;
      updates.asesorNombre = nombre;
      updates.asesorApellido = apellido;
    }

    if (nuevoEstado === "bot") {
      // Admin/supervisor pueden desasignar a cualquiera; vendedor solo a sí mismo
      if (ROLES_VENDEDOR.includes(rol) && String(conv.asesorId) !== String(userId)) {
        return res
          .status(403)
          .json({ status: 403, error: "No podés devolver una conversación que no es tuya" });
      }
      updates.asesorId = null;
      updates.asesorNombre = null;
      updates.asesorApellido = null;
    }

    await conv.update(updates);

    if (nuevoEstado === "asesor") {
      try {
        await limpiarEsperandoConfirmacionVisita(conv.id);
      } catch (_) {}
    }

    // Cerrar/perder la consulta vinculada — la contraparte de la sincronización
    // que ya existía del lado de updateConsulta.js (cerrar/perder una consulta
    // ya cerraba el chat). Sin esto, un chat cerrado a mano dejaba la consulta
    // activa para siempre, y los crons de reactivación seguían escribiéndole
    // al cliente.
    if (consultaVinculada) {
      try {
        await ConsultaHistorial.create({
          tipo: "sistema",
          texto:
            `Estado cambiado de "${ESTADO_LABEL_CONSULTA[consultaVinculada.estado]}" a ` +
            `"${ESTADO_LABEL_CONSULTA[estadoConsulta]}" (cierre del chat).`,
          consultaId: consultaVinculada.id,
        });
        await consultaVinculada.update({ estado: estadoConsulta, estadoCambiadoEn: new Date() });
      } catch (err) {
        console.warn(
          `⚠️ No se pudo sincronizar la consulta ${consultaVinculada.id} al cerrar conv ${conv.id}:`,
          err.message,
        );
      }
    }

    try {
      getIO().emit("conversacion:estadoCambiado", {
        conversacionId: conv.id,
        estado: nuevoEstado,
        asesorNombre: updates.asesorNombre || null,
        asesorApellido: updates.asesorApellido || null,
      });
    } catch (_) {}

    return res.status(200).json({ status: 200, resp: conv });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = updateEstado;
