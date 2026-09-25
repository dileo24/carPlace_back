const { obtenerCupoDisponible } = require("../../services/mercadolibreListingsService");

// GET /publicaciones/cupo — cuántas publicaciones Oro/Plata quedan disponibles
// este mes en MercadoLibre (varía mes a mes, no hay un número fijo).
const getCupoPublicaciones = async (req, res) => {
  try {
    const cupo = await obtenerCupoDisponible();
    res.status(200).json({ status: 200, resp: cupo });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = getCupoPublicaciones;
