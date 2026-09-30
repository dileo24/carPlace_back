// middlewares/crm/consultas/getConsultas.js
const { Consulta, ConsultaHistorial, Conversacion, EventoCalendario } = require("../../../db");
const { Op } = require("sequelize");
const hoyArgentina = require("../../../services/hoyArgentina");

const PESO_ESTADO = { con_oferta: 3, seguimiento: 2, nuevo: 1, cerrado: 0, perdido: 0 };

// Prioridad automática de una consulta (mayor = más arriba), por este orden:
//  1. Tiene una cita pendiente/confirmada de hoy en adelante (la más próxima primero).
//  2. Está calificada (interés real validado).
//  3. Etapa del pipeline: con oferta > seguimiento > nuevo > cerrado/perdido.
//  4. Presupuesto declarado (mayor primero).
//  5. Más reciente primero.
const calcularPrioridad = (consulta, hoy) => {
  const citasProximas = (consulta.eventos || [])
    .filter(e => ["pendiente", "confirmada"].includes(e.estado) && e.fecha >= hoy)
    .map(e => e.fecha)
    .sort();
  return {
    proximaCita: citasProximas[0] || null,
    calificado: consulta.calificado ? 1 : 0,
    estado: PESO_ESTADO[consulta.estado] ?? 0,
    presupuesto: Number(consulta.presupuesto) || 0,
    creada: new Date(consulta.createdAt).getTime() || 0,
  };
};

const compararPrioridad = (x, y) => {
  const a = x.prioridad;
  const b = y.prioridad;
  if (a.proximaCita !== b.proximaCita) {
    if (!a.proximaCita) return 1;
    if (!b.proximaCita) return -1;
    return a.proximaCita < b.proximaCita ? -1 : 1;
  }
  return b.calificado - a.calificado || b.estado - a.estado || b.presupuesto - a.presupuesto || b.creada - a.creada;
};

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

    // Orden automático por prioridad (ver calcularPrioridad): se ordena sobre
    // un set liviano de columnas de TODAS las consultas del filtro, se recorta
    // la página pedida y recién ahí se cargan las filas completas — así el
    // orden es consistente entre páginas sin traer el historial de todas.
    const liviano = await Consulta.findAll({
      where,
      attributes: ["id", "estado", "calificado", "presupuesto", "createdAt"],
      include: [
        {
          model: EventoCalendario,
          as: "eventos",
          attributes: ["fecha", "estado"],
          required: false,
        },
      ],
    });
    const hoy = hoyArgentina();
    const idsOrdenados = liviano
      .map(c => ({ id: c.id, prioridad: calcularPrioridad(c, hoy) }))
      .sort(compararPrioridad)
      .map(c => c.id);
    const count = idsOrdenados.length;
    const idsPagina = idsOrdenados.slice(offset, offset + pageSize);

    const filas = await Consulta.findAll({
      where: { id: idsPagina },
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
    });
    const posicion = new Map(idsPagina.map((id, i) => [id, i]));
    const rows = filas.sort((x, y) => posicion.get(x.id) - posicion.get(y.id));

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
