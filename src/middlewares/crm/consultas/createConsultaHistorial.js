const { Consulta, ConsultaHistorial } = require("../../../db");

const ROLES_FULL_ACCESS = ["admin", "supervisor"];

const createConsultaHistorial = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    const userId = req.user?.id ?? null;
    const esAdmin = ROLES_FULL_ACCESS.includes(rol);

    const { id } = req.params;
    const { tipo, texto } = req.body;

    const consulta = await Consulta.findByPk(id);
    if (!consulta) {
      return res.status(404).json({ status: 404, error: "Consulta no encontrada" });
    }

    if (!esAdmin && consulta.asesorId && consulta.asesorId !== userId) {
      return res.status(403).json({ status: 403, error: "Sin acceso a esta consulta" });
    }

    const entrada = await ConsultaHistorial.create({
      tipo,
      texto,
      consultaId: id,
      creadoPorId: userId,
    });

    return res.status(201).json({ status: 201, resp: entrada });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = createConsultaHistorial;
