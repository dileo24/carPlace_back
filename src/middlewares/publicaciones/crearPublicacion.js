const { Op } = require("sequelize");
const { Publicacion } = require("../../db");
const { crearPublicacionMercadoLibre } = require("../../services/mercadolibreListingsService");

const DIAS_EXPIRACION = 60;

// POST /publicaciones — Body: { autoId, titulo?, descripcion? }
// Por ahora solo MercadoLibre; "plataforma" queda fijo así hasta sumar otra.
const crearPublicacion = async (req, res) => {
  try {
    const { autoId, titulo, descripcion, listingType } = req.body;
    if (!autoId) {
      return res.status(400).json({ status: 400, error: "Falta autoId" });
    }

    // Evita publicar dos veces el mismo auto mientras ya tiene una activa —
    // se puede duplicar sin querer haciendo doble click, o al no notar que ya
    // estaba publicado/pausado.
    const yaPublicada = await Publicacion.findOne({
      where: { autoId, estado: { [Op.in]: ["publicada", "pausada"] } },
    });
    if (yaPublicada) {
      return res.status(409).json({
        status: 409,
        error: "Este auto ya tiene una publicación activa o pausada en MercadoLibre.",
      });
    }

    const resultado = await crearPublicacionMercadoLibre(autoId, { titulo, descripcion, listingType });

    const ahora = new Date();
    const expiraEn = new Date(ahora.getTime() + DIAS_EXPIRACION * 24 * 60 * 60 * 1000);

    const publicacion = await Publicacion.create({
      autoId,
      plataforma: "mercadolibre",
      externalId: resultado.itemId,
      permalink: resultado.permalink,
      estado: "publicada",
      tituloUsado: resultado.tituloUsado,
      descripcionUsada: descripcion || null,
      publicadoEn: ahora,
      expiraEn,
    });

    res.status(201).json({ status: 201, resp: publicacion });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = crearPublicacion;
