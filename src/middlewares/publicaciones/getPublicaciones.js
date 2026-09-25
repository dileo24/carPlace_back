const { Publicacion, Auto } = require("../../db");
const { consultarEstadoReal, interpretarEstadoReal } = require("../../services/mercadolibreListingsService");

// GET /publicaciones — lista completa, opcionalmente filtrada por autoId
// (?autoId=123) para el módulo admin de un auto puntual.
const getPublicaciones = async (req, res) => {
  try {
    const where = {};
    if (req.query.autoId) where.autoId = req.query.autoId;

    const publicaciones = await Publicacion.findAll({
      where,
      include: [{ model: Auto, attributes: ["id", "marca", "modelo", "anio", "img"] }],
      order: [["id", "DESC"]],
    });

    // Chequeo proactivo contra la API real de ML para las que creemos activas,
    // pausadas, o con error — si el admin las gestionó directamente en
    // MercadoLibre (la pausó/eliminó desde ahí), ML la rechazó por una
    // política de categoría, o ese rechazo ya se resolvió (ej. el admin
    // cargó el km real), esto corrige la fila sola acá en vez de que el CRM
    // siga mostrando un estado o motivo viejo hasta que alguien note algo mal.
    // Se compara estado Y motivo — una fila puede seguir en "error" pero con
    // un motivo distinto/mejor detectado, y eso también tiene que reflejarse.
    await Promise.all(
      publicaciones
        .filter(p => ["publicada", "pausada", "error"].includes(p.estado))
        .map(async p => {
          try {
            const real = await consultarEstadoReal(p.externalId);
            const interpretado = interpretarEstadoReal(real);
            if (interpretado && (interpretado.estado !== p.estado || interpretado.motivo !== p.ultimoErrorMensaje)) {
              await p.update({ estado: interpretado.estado, ultimoErrorMensaje: interpretado.motivo });
            }
          } catch (err) {
            console.warn(`No se pudo verificar el estado real de la publicación ${p.id}:`, err.message);
          }
        }),
    );

    // Auto.img es DataTypes.JSON pero a veces vuelve como string sin
    // parsear (quirk conocido de MySQL) — lo normalizamos acá para que el
    // front pueda usar Auto.img[0] directo como thumbnail.
    const resultado = publicaciones.map(p => {
      const obj = p.toJSON();
      if (obj.Auto?.img && typeof obj.Auto.img === "string") {
        try {
          obj.Auto.img = JSON.parse(obj.Auto.img);
        } catch (_) {
          obj.Auto.img = [];
        }
      }
      return obj;
    });

    res.status(200).json({ status: 200, resp: resultado });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = getPublicaciones;
