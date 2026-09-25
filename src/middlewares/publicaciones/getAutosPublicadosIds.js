const { Publicacion } = require("../../db");
const { Op } = require("sequelize");

// GET /publicaciones/autos-publicados — solo los IDs de autos con una
// publicación activa/pausada en MercadoLibre. Liviano a propósito (sin el
// chequeo proactivo contra la API real que hace getPublicaciones.js): esto lo
// consume el Stock para mostrar un badge "ML" en cada card, y no vale la pena
// pagar una llamada a MercadoLibre por auto solo para pintar un ícono.
const getAutosPublicadosIds = async (req, res) => {
  try {
    const publicaciones = await Publicacion.findAll({
      where: { estado: { [Op.in]: ["publicada", "pausada"] } },
      attributes: ["autoId"],
    });
    const autoIds = [...new Set(publicaciones.map(p => p.autoId).filter(id => id != null))];
    res.status(200).json({ status: 200, resp: autoIds });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = getAutosPublicadosIds;
