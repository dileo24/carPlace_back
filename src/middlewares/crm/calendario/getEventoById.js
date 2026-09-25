const { EventoCalendario } = require("../../../db");

const getEventoById = async (req, res) => {
  try {
    const { id } = req.params;

    const evento = await EventoCalendario.findByPk(id);

    if (!evento) {
      return res.status(404).json({
        status: 404,
        error: "Evento no encontrado",
      });
    }

    return res.status(200).json({
      status: 200,
      resp: evento,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      status: 500,
      error: error.message,
    });
  }
};

module.exports = getEventoById;