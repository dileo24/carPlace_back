const { Op } = require("sequelize");
const { Consulta, Conversacion } = require("../../../db");
const { variantesTelefono, ESTADOS_ACTIVOS } = require("../../../services/consultasHelper");

// Usado por el formulario de "nueva visita" para avisar si el teléfono
// cargado ya tiene una consulta activa o una conversación de WhatsApp, y
// dejar que el usuario decida si asociarla en vez de asumirlo en silencio.
const buscarContactoPorTelefono = async (req, res) => {
  try {
    const { telefono } = req.query;
    if (!telefono) {
      return res.status(400).json({ status: 400, error: "El teléfono es requerido" });
    }

    const variantes = variantesTelefono(telefono);
    if (!variantes.length) {
      return res.status(200).json({ status: 200, resp: { consulta: null, conversacion: null } });
    }

    const [consulta, conversacion] = await Promise.all([
      Consulta.findOne({
        where: { telefono: { [Op.in]: variantes }, estado: { [Op.in]: ESTADOS_ACTIVOS } },
        attributes: ["id", "nombre", "apellido", "vehiculo", "estado"],
        order: [["createdAt", "DESC"]],
      }),
      Conversacion.findOne({
        where: { telefono: { [Op.in]: variantes } },
        attributes: ["id", "contactoNombre", "contactoApellido"],
        order: [["ultimaActividad", "DESC"]],
      }),
    ]);

    return res.status(200).json({ status: 200, resp: { consulta, conversacion } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = buscarContactoPorTelefono;
