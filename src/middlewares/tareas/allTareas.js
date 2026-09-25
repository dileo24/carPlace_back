// controllers/tareas/allTareas.js
const { Tarea } = require("../../db");
const { Op } = require("sequelize");

const allTareas = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    const userId = req.user?.id ?? null;

    // ... resto de query params igual ...

    const where = {};

    // Admin, supervisor y socio solo ven sus propias tareas
    if (["admin", "supervisor", "socio"].includes(rol) && userId) {
      where.creadoPorId = userId;
    }
    const {
      estado,
      prioridad,
      tipo,
      creadoPor,
      search,
      orderBy = "creadoEn",
      orderDir = "DESC",
    } = req.query;

    const COLUMNAS_PERMITIDAS = ["id", "titulo", "tipo", "prioridad", "estado", "creadoEn"];
    const DIRS_PERMITIDAS = ["ASC", "DESC"];
    const columna = COLUMNAS_PERMITIDAS.includes(orderBy) ? orderBy : "creadoEn";
    const direccion = DIRS_PERMITIDAS.includes(orderDir.toUpperCase())
      ? orderDir.toUpperCase()
      : "DESC";

    if (estado) where.estado = estado;
    if (prioridad) where.prioridad = prioridad;
    if (tipo) where.tipo = tipo;
    if (creadoPor) where.creadoPor = creadoPor;

    if (search) {
      where[Op.or] = [
        { titulo: { [Op.like]: `%${search}%` } },
        { descripcion: { [Op.like]: `%${search}%` } },
      ];
    }

    const tareas = await Tarea.findAll({
      where,
      order: [[columna, direccion]],
    });

    res.status(200).json({ status: 200, resp: tareas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = allTareas;
