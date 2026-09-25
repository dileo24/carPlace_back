const { Conversacion, Mensaje, Consulta, EventoCalendario, ConsultaHistorial } = require("../../../db");
const { Op } = require("sequelize");

const ROLES_FULL = ["admin", "supervisor"];
const ROLES_VENDEDOR = ["vendedor", "publicador_vendedor"];

const getConversaciones = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    const userId = req.user?.id ?? null;

    const where = {};

    if (ROLES_VENDEDOR.includes(rol)) {
      // Nuevas del bot (sin tomar, para que cualquier vendedor pueda agarrarlas)
      // + derivadas a un asesor pero sin tomar todavía (mismo caso: libres para agarrar)
      // + las que ya tiene asignadas (para seguir viéndolas, aunque las haya cerrado).
      where[Op.or] = [
        { estado: "bot" },
        { estado: "asesor", asesorId: null },
        { asesorId: userId },
      ];
    }
    // supervisor y admin: where vacío → ven todo

    const { estado, canal } = req.query;
    if (estado) where.estado = estado;
    if (canal) where.canal = canal;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * pageSize;

    const { rows, count } = await Conversacion.findAndCountAll({
      where,
      include: [
        {
          model: Mensaje,
          as: "mensajes",
          separate: true,
          order: [["timestamp", "ASC"]],
        },
        {
          model: Consulta,
          as: "consulta",
          required: false,
          attributes: ["id", "estado", "vehiculo", "formaPago", "presupuesto"],
          include: [
            {
              model: EventoCalendario,
              as: "eventos",
              attributes: ["id", "titulo", "fecha", "horaInicio", "estado"],
              required: false,
            },
          ],
        },
        {
          model: ConsultaHistorial,
          as: "notas",
          required: false,
        },
      ],
      order: [["ultimaActividad", "DESC"]],
      limit: pageSize,
      offset,
      distinct: true,
    });

    const esAdmin = ROLES_FULL.includes(rol);

    const resultado = rows.map(c => {
      const obj = c.toJSON();
      // El intercambio del seguimiento de 7 días (automático) y cualquier
      // mensaje que el admin haya ocultado a mano quedan afuera para cualquier
      // vendedor — solo admin/supervisor los ven. Si el último mensaje real es
      // justo uno de estos, recalculamos la vista previa para que no se filtre
      // el texto oculto por ahí.
      if (!esAdmin) {
        const todos = obj.mensajes || [];
        const visibles = todos.filter(m => !m.esSeguimiento7Dias && !m.ocultoManual);
        if (visibles.length !== todos.length) {
          obj.ultimoMensaje = visibles.length ? visibles[visibles.length - 1].texto : null;
          obj.ultimaActividad = visibles.length ? visibles[visibles.length - 1].timestamp : obj.createdAt;
        }
        obj.mensajes = visibles;
      }
      return obj;
    });

    return res.status(200).json({
      status: 200,
      resp: resultado,
      meta: { page, pageSize, total: count, hasMore: offset + resultado.length < count },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = getConversaciones;
