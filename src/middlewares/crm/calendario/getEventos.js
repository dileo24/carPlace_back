const { EventoCalendario, User } = require("../../../db");
const { Op } = require("sequelize");

const getEventos = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    const userId = req.user?.id ?? null;
    const { mes, usuarioId: usuarioFiltro } = req.query;
    const where = {};

    if (mes) {
      const [year, month] = mes.split("-");
      const paddedMonth = month.padStart(2, "0");
      const lastDay = new Date(Number(year), Number(month), 0).getDate();
      where.fecha = {
        [Op.between]: [`${year}-${paddedMonth}-01`, `${year}-${paddedMonth}-${lastDay}`],
      };
    }

    let eventos = await EventoCalendario.findAll({
      where,
      order: [
        ["fecha", "ASC"],
        ["horaInicio", "ASC"],
      ],
    });

    // invitadosIds es un array serializado (TEXT con JSON.stringify) — no se
    // puede filtrar por elemento exacto con un LIKE de subcadena a nivel SQL
    // (matchearía "1" contra "21", "10", "31", etc.), así que el filtro por
    // rol/usuario se aplica en JS sobre el array ya parseado por el getter.
    if (rol === "admin") {
      // Admin ve todo, pero puede filtrar por usuario desde el header de filtro
      if (usuarioFiltro && usuarioFiltro !== "todos") {
        const uid = Number(usuarioFiltro);
        eventos = eventos.filter(
          e => e.usuarioId === uid || e.creadoPorId === uid || (e.invitadosIds ?? []).includes(uid),
        );
      }
    } else if (rol === "socio") {
      // El socio solo ve sus propios eventos — a diferencia del resto del
      // equipo, no comparte el calendario de visitas/entregas.
      eventos = eventos.filter(
        e =>
          e.creadoPorId === userId ||
          e.usuarioId === userId ||
          (e.invitadosIds ?? []).includes(userId),
      );
    } else {
      eventos = eventos.filter(
        e =>
          e.creadoPorId === userId ||
          e.usuarioId === userId ||
          (e.invitadosIds ?? []).includes(userId) ||
          ["visita", "entrega"].includes(e.tipo),
      );
    }

    // ── Resolver nombres en una sola query ────────────────────────────────────
    const userIdSet = new Set();
    for (const e of eventos) {
      if (e.usuarioId) userIdSet.add(e.usuarioId);
      if (e.creadoPorId) userIdSet.add(e.creadoPorId);
      for (const id of e.invitadosIds ?? []) userIdSet.add(id);
    }

    const usuarioMap = {};
    const usuarioColorMap = {};
    if (userIdSet.size > 0) {
      const usuarios = await User.findAll({
        where: { id: { [Op.in]: [...userIdSet] } },
        attributes: ["id", "name", "color"],
      });
      for (const u of usuarios) {
        usuarioMap[u.id] = u.name;
        usuarioColorMap[u.id] = u.color;
      }
    }

    // ── Enriquecer cada evento con los nombres ────────────────────────────────
    const resp = eventos.map(e => {
      const plain = e.toJSON();
      return {
        ...plain,
        usuarioNombre: usuarioMap[plain.usuarioId] ?? null,
        usuarioColor: usuarioColorMap[plain.usuarioId] ?? null,
        creadoPorNombre: usuarioMap[plain.creadoPorId] ?? null,
        invitados: (plain.invitadosIds ?? []).map(id => ({
          id,
          name: usuarioMap[id] ?? null,
        })),
      };
    });

    res.status(200).json({ status: 200, resp });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = getEventos;
