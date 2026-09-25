const { Op } = require("sequelize");
const { Publicacion } = require("../../db");
const {
  pausarPublicacionMercadoLibre,
  cerrarPublicacionMercadoLibre,
  eliminarPublicacionMercadoLibre,
  reactivarPublicacionMercadoLibre,
  consultarEstadoReal,
  interpretarEstadoReal,
} = require("../../services/mercadolibreListingsService");

const DIAS_EXPIRACION = 60;

// Si el admin gestionó la publicación directamente en MercadoLibre (la pausó,
// finalizó o eliminó desde ahí, sin pasar por el CRM), nuestra fila queda
// desactualizada y ML rechaza la acción — pero el texto del error de ML
// cambia según en qué estado estaba el item ANTES de cambiar (distintos
// mensajes de "Valid transitions are [...]" según el caso), así que no sirve
// para detectarlo de forma confiable. En vez de adivinar por el texto, ante
// cualquier error se chequea el estado real del item (interpretarEstadoReal,
// la misma lógica que usa el chequeo proactivo de getPublicaciones.js) y se
// corrige la fila sola en vez de mostrar el error crudo.
async function intentarReconciliar(publicacion) {
  let real;
  try {
    real = await consultarEstadoReal(publicacion.externalId);
  } catch {
    return null; // no se pudo confirmar nada — que se muestre el error original
  }
  const interpretado = interpretarEstadoReal(real);
  if (!interpretado || interpretado.estado === publicacion.estado) return null;

  await publicacion.update({ estado: interpretado.estado, ultimoErrorMensaje: interpretado.motivo });
  const label = { eliminada: "eliminada", cerrada: "finalizada", pausada: "pausada", publicada: "activa", error: "rechazada" }[interpretado.estado];
  return `Esta publicación ya estaba ${label} en MercadoLibre (parece que se gestionó directamente ahí) — se actualizó el registro acá.${interpretado.motivo ? ` ${interpretado.motivo}` : ""}`;
}

// pausar / cerrar (finalizar) / eliminar / reactivar comparten esta misma
// lógica — solo cambia qué acción de ML se llama y a qué estado final se deja
// la fila. Son 4 acciones distintas: pausar y reactivar son reversibles entre
// sí; cerrar finaliza la publicación pero queda visible como "Inactiva" en
// ML; eliminar además la saca del todo del listado (ver
// mercadolibreListingsService.js para el detalle de cada una).
const construirHandler = (accionML, estadoFinal) => async (req, res) => {
  try {
    const publicacion = await Publicacion.findByPk(req.params.id);
    if (!publicacion) {
      return res.status(404).json({ status: 404, error: "Publicación no encontrada" });
    }

    try {
      await accionML(publicacion.externalId);
      await publicacion.update({ estado: estadoFinal });
      return res.status(200).json({ status: 200, resp: publicacion });
    } catch (error) {
      const info = await intentarReconciliar(publicacion);
      if (info) {
        return res.status(200).json({ status: 200, resp: publicacion, info });
      }
      throw error;
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

const pausarPublicacion = construirHandler(pausarPublicacionMercadoLibre, "pausada");
const cerrarPublicacion = construirHandler(cerrarPublicacionMercadoLibre, "cerrada");
const eliminarPublicacion = construirHandler(eliminarPublicacionMercadoLibre, "eliminada");
const reactivarPublicacion = construirHandler(reactivarPublicacionMercadoLibre, "publicada");

// POST /publicaciones/:id/republicar — la publicación vieja ya está
// cerrada/expirada, así que republicar es crear una publicación NUEVA (ML no
// permite reabrir un item cerrado) y dejar la vieja como está, para no perder
// el historial.
const republicarPublicacion = async (req, res) => {
  try {
    const vieja = await Publicacion.findByPk(req.params.id);
    if (!vieja) {
      return res.status(404).json({ status: 404, error: "Publicación no encontrada" });
    }

    const yaPublicada = await Publicacion.findOne({
      where: { autoId: vieja.autoId, estado: { [Op.in]: ["publicada", "pausada"] } },
    });
    if (yaPublicada) {
      return res.status(409).json({
        status: 409,
        error: "Este auto ya tiene una publicación activa o pausada en MercadoLibre.",
      });
    }

    const { crearPublicacionMercadoLibre } = require("../../services/mercadolibreListingsService");
    const resultado = await crearPublicacionMercadoLibre(vieja.autoId, {
      titulo: vieja.tituloUsado,
      descripcion: vieja.descripcionUsada,
    });

    const ahora = new Date();
    const expiraEn = new Date(ahora.getTime() + DIAS_EXPIRACION * 24 * 60 * 60 * 1000);

    const nueva = await Publicacion.create({
      autoId: vieja.autoId,
      plataforma: "mercadolibre",
      externalId: resultado.itemId,
      permalink: resultado.permalink,
      estado: "publicada",
      tituloUsado: resultado.tituloUsado,
      descripcionUsada: vieja.descripcionUsada,
      publicadoEn: ahora,
      expiraEn,
    });

    res.status(201).json({ status: 201, resp: nueva });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = {
  pausarPublicacion,
  cerrarPublicacion,
  eliminarPublicacion,
  reactivarPublicacion,
  republicarPublicacion,
};
