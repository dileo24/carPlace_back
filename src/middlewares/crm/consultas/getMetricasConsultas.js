// middlewares/crm/consultas/getMetricasConsultas.js
const { Consulta } = require("../../../db");
const { Op } = require("sequelize");

const ROLES_FULL_ACCESS = ["admin", "supervisor"];

const getMetricasConsultas = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    const userId = req.user?.id || null;
    const esAdmin = ROLES_FULL_ACCESS.includes(rol);

    const where = esAdmin ? {} : { asesorId: userId };

    const consultas = await Consulta.findAll({ where });

    const porEstado = {
      nuevo: 0,
      con_oferta: 0,
      seguimiento: 0,
      cerrado: 0,
      perdido: 0,
    };
    consultas.forEach(c => {
      if (porEstado[c.estado] !== undefined) porEstado[c.estado]++;
    });

    const activas = consultas.filter(c => !["cerrado", "perdido"].includes(c.estado));
    const cerradas = consultas.filter(c => c.estado === "cerrado");

    const pipeline = activas.reduce((acc, c) => acc + (c.presupuesto || 0), 0);

    const tasaConversion = consultas.length
      ? Math.round((cerradas.length / consultas.length) * 100)
      : 0;

    return res.status(200).json({
      status: 200,
      resp: {
        total: consultas.length,
        activas: activas.length,
        porEstado,
        pipeline,
        tasaConversion,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = getMetricasConsultas;
