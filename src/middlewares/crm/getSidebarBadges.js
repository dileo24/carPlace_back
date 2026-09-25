const { Conversacion, EventoCalendario } = require("../../db");
const { Op } = require("sequelize");
const hoyArgentina = require("../../services/hoyArgentina");

const ROLES_VENDEDOR = ["vendedor", "publicador_vendedor"];

const getSidebarBadges = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    const userId = req.user?.id ?? null;

    // ── Conversaciones ────────────────────────────────────────────────────────────
    let whereConv;

    if (rol === "admin") {
      // El admin ve el badge basado en SU flag independiente
      whereConv = { adminNoLeido: true };
    } else {
      whereConv = { noLeido: { [Op.gt]: 0 } };
      if (ROLES_VENDEDOR.includes(rol)) {
        // Mismo criterio de visibilidad que getConversaciones.js — si no, el
        // badge puede contar conversaciones que ese vendedor ni siquiera ve
        // en su lista (ej. una "cerrada" de otro vendedor).
        whereConv[Op.or] = [
          { estado: "bot" },
          { estado: "asesor", asesorId: null },
          { asesorId: userId },
        ];
      }
    }

    const conversacionesBadge = await Conversacion.count({ where: whereConv });

    // ── Calendario ────────────────────────────────────────────────────────────
    const hoy = hoyArgentina(); // "YYYY-MM-DD"

    // invitadosIds es un array serializado — no se puede filtrar con LIKE a
    // nivel SQL (matchea "1" como subcadena de "21", "10", etc.), así que
    // ese filtro se aplica en JS sobre el array ya parseado.
    const eventosDeHoy = await EventoCalendario.findAll({
      where: { fecha: hoy, estado: { [Op.in]: ["pendiente", "confirmada"] } },
      attributes: ["id", "usuarioId", "creadoPorId", "invitadosIds"],
    });

    const calendarioBadge =
      !ROLES_VENDEDOR.includes(rol) && rol !== "supervisor"
        ? eventosDeHoy.length // admin: sin filtro de usuario → ve todos los eventos de hoy
        : eventosDeHoy.filter(
            e => e.usuarioId === userId || e.creadoPorId === userId || (e.invitadosIds ?? []).includes(userId),
          ).length;

    return res.status(200).json({
      status: 200,
      resp: {
        conversaciones: conversacionesBadge,
        calendario: calendarioBadge,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = getSidebarBadges;
