// middlewares/crm/consultas/getConsultas.js
const { Consulta, ConsultaHistorial, Conversacion, EventoCalendario } = require("../../../db");
const { Op } = require("sequelize");

const ROLES_FULL_ACCESS = ["admin", "supervisor"];

const getConsultas = async (req, res) => {
  try {
    const { estado, origen, busqueda, asesorId } = req.query;

    const rol = req.user?.rol || "";

    const userId = req.user?.id ?? null;

    const esAdmin = ROLES_FULL_ACCESS.includes(rol);

    const where = {};

    // vendedores solo ven sus consultas
    if (!esAdmin) {
      where.asesorId = userId;
    }

    if (estado) where.estado = estado;
    if (origen) where.origen = origen;

    // solo admin/supervisor pueden filtrar por asesor
    if (asesorId && esAdmin) {
      where.asesorId = asesorId;
    }

    if (busqueda) {
      where[Op.or] = [
        { vehiculo: { [Op.like]: `%${busqueda}%` } },
        { categoria: { [Op.like]: `%${busqueda}%` } },

        ...(esAdmin
          ? [
              { nombre: { [Op.like]: `%${busqueda}%` } },
              { apellido: { [Op.like]: `%${busqueda}%` } },
            ]
          : []),
      ];
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * pageSize;

    const { rows, count } = await Consulta.findAndCountAll({
      where,
      include: [
        { model: ConsultaHistorial, as: "historial" },
        {
          model: Conversacion,
          as: "conversacion",
          attributes: ["id"],
          required: false,
          foreignKey: "consultaId",
        },
        {
          model: EventoCalendario,
          as: "eventos",
          attributes: ["id", "titulo", "fecha", "horaInicio", "estado"],
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: pageSize,
      offset,
      distinct: true,
    });

    const resultado = rows.map(c => {
      const obj = c.toJSON();
      obj.conversacionId = obj.conversacion?.id || null;
      delete obj.conversacion;

      return obj;
    });

    return res.status(200).json({
      status: 200,
      resp: resultado,
      meta: { page, pageSize, total: count, hasMore: offset + resultado.length < count },
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      status: 500,
      error: err.message,
    });
  }
};

module.exports = getConsultas;
