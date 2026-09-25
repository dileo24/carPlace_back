// middlewares/crm/consultas/getConsultaById.js
const { Consulta, ConsultaHistorial, Conversacion, EventoCalendario } = require("../../../db");

const ROLES_FULL_ACCESS = ["admin", "supervisor"];

const getConsultaById = async (req, res) => {
  try {
    const { id } = req.params;
    const rol = req.user?.rol || "";
    const userId = req.user?.id ?? null;
    const esAdmin = ROLES_FULL_ACCESS.includes(rol);

    const consulta = await Consulta.findByPk(id, {
      include: [
        { model: ConsultaHistorial, as: "historial" },
        {
          model: Conversacion,
          as: "conversacion",
          attributes: ["id"],
          required: false,
        },
        {
          model: EventoCalendario,
          as: "eventos",
          attributes: ["id", "titulo", "fecha", "horaInicio", "estado"],
          required: false,
        },
      ],
    });

    if (!consulta) {
      return res.status(404).json({ status: 404, error: "Consulta no encontrada" });
    }

    // Vendedor solo puede ver sus propias consultas
    if (!esAdmin && String(consulta.asesorId) !== String(userId)) {
      return res.status(403).json({ status: 403, error: "Sin acceso a esta consulta" });
    }

    const obj = consulta.toJSON();
    obj.conversacionId = obj.conversacion?.id || null;
    delete obj.conversacion;

    return res.status(200).json({ status: 200, resp: obj });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = getConsultaById;
