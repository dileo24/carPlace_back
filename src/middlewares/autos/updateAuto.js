const { Auto, Categoria, Publicacion } = require("../../db");
const { parsearEnteroLimpio } = require("../../services/formatearAuto");
const {
  actualizarPublicacionMercadoLibre,
  pausarPublicacionMercadoLibre,
} = require("../../services/mercadolibreListingsService");

const CAMPOS_NUMERICOS = ["anio", "km", "precio", "precio_oferta", "precio_compra"];

const updateAuto = async (req, res) => {
  try {
    const { id } = req.params;
    const auto = req.body;

    // anio/km/precio/precio_oferta son columnas INT: el front todavía manda
    // estos campos como texto con puntos de miles (ej. "51.000.000").
    for (const campo of CAMPOS_NUMERICOS) {
      if (auto[campo] !== undefined) auto[campo] = parsearEnteroLimpio(auto[campo]);
    }

    // Marca cuándo se confirmó el precio InfoAuto del mes en curso — el cron
    // de rotación (rotarPrecioInfo.js) lo usa para no pisar un valor recién
    // cargado si el catch-up de "mes pendiente" dispara tarde en el mes.
    if (auto.precio_info_mes_actual) {
      auto.precio_info_actualizado_en = new Date();
    }

    const AutoFinded = await Auto.findByPk(id);

    if (!AutoFinded) {
      return res.status(404).json({ status: "404", resp: `Auto con id: ${id} no encontrado.` });
    }

    // Actualizar categorías si vienen en el body
    if (auto.categorias && Array.isArray(auto.categorias)) {
      // Extraer solo los IDs de las categorías
      const categoriaIds = auto.categorias.map(cat => cat.id);

      // Verificar que todas las categorías existan
      const categorias = await Categoria.findAll({
        where: { id: categoriaIds },
      });

      if (categorias.length !== categoriaIds.length) {
        const foundIds = categorias.map(c => c.id);
        const missingIds = categoriaIds.filter(id => !foundIds.includes(id));
        return res.status(404).json({
          status: "404",
          resp: `Las siguientes categorías no fueron encontradas: ${missingIds.join(", ")}`,
        });
      }

      // Establecer las categorías
      await AutoFinded.setCategorias(categorias);

      // Eliminar la propiedad categorias del objeto auto para evitar conflictos
      delete auto.categorias;
    }

    // Actualizar los demás campos del auto (incluyendo auto.img si vino, tal
    // cual lo mande el front). El borrado de fotos en Cloudinary NUNCA se
    // infiere acá comparando arrays viejo/nuevo — eso es lo que causaba fotos
    // rotas: dos guardados casi simultáneos del mismo auto (dos pestañas, o
    // el propio doble PUT de handleSave con una respuesta que llega fuera de
    // orden) podían hacer que un array desactualizado marcara como "sacada"
    // una foto que en realidad seguía puesta, borrándola de Cloudinary para
    // siempre aunque su URL quedara igual en Auto.img. Borrar una foto ahora
    // es SIEMPRE una acción explícita y puntual (ver handleRemoveImage en
    // useAutoDetail.js, que borra por su propio ID antes de actualizar el
    // array) — nunca una inferencia por diff acá.
    await AutoFinded.update(auto);

    // Sincronizar con MercadoLibre si el auto tiene una publicación activa —
    // fire-and-forget: no bloquea la respuesta ni rompe la edición del auto
    // si la sincronización externa falla (queda logueado nomás).
    Publicacion.findAll({ where: { autoId: id, estado: "publicada" } })
      .then(async publicaciones => {
        if (!publicaciones.length) return;

        const seVendioOSeOculto =
          ["vendido", "no_disponible"].includes(auto.estado) || auto.visible === false;

        // Cada publicación se sincroniza en su propio try/catch — si falla
        // una (ej. la de MercadoLibre está en un estado que no acepta el
        // cambio), no debe frenar la sincronización de las demás, y el motivo
        // queda guardado en ultimoErrorMensaje para que se vea en el CRM en
        // vez de solo en el log del servidor.
        for (const publicacion of publicaciones) {
          try {
            if (seVendioOSeOculto) {
              await pausarPublicacionMercadoLibre(publicacion.externalId);
              await publicacion.update({ estado: "pausada", ultimoErrorMensaje: null });
            } else {
              await actualizarPublicacionMercadoLibre(publicacion.externalId, id);
              if (publicacion.ultimoErrorMensaje) await publicacion.update({ ultimoErrorMensaje: null });
            }
          } catch (err) {
            console.error(`No se pudo sincronizar la publicación ${publicacion.id} con MercadoLibre:`, err.message);
            await publicacion.update({ ultimoErrorMensaje: err.message }).catch(() => {});
          }
        }
      })
      .catch(err => console.error(`No se pudo sincronizar el auto ${id} con MercadoLibre:`, err.message));

    return res.status(200).json({
      status: 200,
      resp: `El auto ${auto.modelo || AutoFinded.modelo} se ha actualizado exitosamente.`,
    });
  } catch (error) {
    return res.status(500).json({ status: "500", resp: error.message });
  }
};

module.exports = updateAuto;
