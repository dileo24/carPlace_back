const { Venta, Auto, AutoTareaAlistaje, conn } = require("../../db");
const { deleteFromCloudinary, publicIdFromCloudinaryUrl } = require("../../services/cloudinaryService");
const { eliminarPublicacionesDeAuto } = require("../../services/mercadolibreListingsService");

const createVenta = async (req, res) => {
  try {
    const { vehiculoVendido, fechaVenta, nombre, apellido, telefono, recibioPago, autoRecibido, precioVendido, moneda, autoId } = req.body;

    if (!vehiculoVendido?.trim()) return res.status(400).json({ status: "400", resp: "vehiculoVendido es requerido." });
    if (!fechaVenta)              return res.status(400).json({ status: "400", resp: "fechaVenta es requerido." });
    if (!nombre?.trim())          return res.status(400).json({ status: "400", resp: "nombre es requerido." });
    if (!apellido?.trim())        return res.status(400).json({ status: "400", resp: "apellido es requerido." });
    if (!telefono?.trim())        return res.status(400).json({ status: "400", resp: "telefono es requerido." });

    let auto = null;
    let publicacionesFallidas = [];
    // Snapshot de compra/gastos/ganancia — el Auto se destruye más abajo en
    // la misma transacción, así que estos datos hay que copiarlos a la Venta
    // ahora o se pierden para siempre.
    let datosPatrimonio = { propietarioAuto: "agencia", fechaCompra: null, precioCompra: null, gastos: null, gastosDetalle: null, ganancia: null };
    if (autoId) {
      auto = await Auto.findByPk(autoId, {
        include: [{ model: AutoTareaAlistaje, as: "tareasAlistaje" }],
      });
      if (!auto) return res.status(404).json({ status: "404", resp: "El vehículo seleccionado del catálogo ya no existe." });

      const tareasAlistaje = auto.tareasAlistaje || [];
      const gastos = tareasAlistaje.reduce((s, t) => s + (t.precio || 0), 0);
      const gastosDetalle = tareasAlistaje.map(t => ({ texto: t.texto, precio: t.precio ?? null }));
      const precioVendidoNum = parseInt(String(precioVendido ?? "").replace(/\./g, ""), 10);
      const ganancia =
        auto.precio_compra != null && !Number.isNaN(precioVendidoNum)
          ? precioVendidoNum - gastos - auto.precio_compra
          : null;

      datosPatrimonio = {
        propietarioAuto: auto.propietario || "agencia",
        fechaCompra: auto.fecha_compra || null,
        precioCompra: auto.precio_compra ?? null,
        gastos,
        gastosDetalle,
        ganancia,
      };

      // Si el auto tiene una publicación activa/pausada en MercadoLibre, se
      // elimina también allá antes de darlo de baja — fuera de la transacción
      // (es una llamada HTTP externa, no debe mantener el lock de la DB
      // abierto) y best-effort, igual que el borrado de fotos en Cloudinary.
      // Si falla, la fila de Publicacion sobrevive (autoId queda en null,
      // ver db.js) para poder gestionarla después en vez de perderse.
      publicacionesFallidas = await eliminarPublicacionesDeAuto(autoId);
    }

    // La venta y la baja del auto del catálogo se hacen en la MISMA transacción:
    // o quedan registradas las dos cosas, o no queda ninguna. Antes eran dos
    // llamadas HTTP separadas desde el frontend (borrar el auto, después crear
    // la venta) — si la segunda fallaba, el auto ya estaba borrado sin que
    // quedara ninguna venta registrada.
    const venta = await conn.transaction(async t => {
      const nuevaVenta = await Venta.create(
        {
          vehiculoVendido: vehiculoVendido.trim(),
          fechaVenta,
          nombre: nombre.trim(),
          apellido: apellido.trim(),
          telefono: telefono.trim(),
          recibioPago: recibioPago ?? false,
          autoRecibido: recibioPago && autoRecibido ? autoRecibido.trim() : null,
          precioVendido: precioVendido,
          moneda: moneda || "ARS",
          autoId: autoId || null,
          ...datosPatrimonio,
        },
        { transaction: t },
      );

      if (auto) {
        await auto.destroy({ transaction: t });
      }

      return nuevaVenta;
    });

    // Borrado de las imágenes en Cloudinary: best-effort, después de que la
    // transacción ya confirmó — si esto falla no hay que revertir nada, el auto
    // y la venta ya quedaron consistentes (mismo criterio que deleteAuto.js).
    if (auto?.img && Array.isArray(auto.img)) {
      await Promise.all(
        auto.img.map(async url => {
          const datos = publicIdFromCloudinaryUrl(url);
          if (!datos) {
            console.warn(`No se pudo determinar public_id para la foto: ${url}`);
            return;
          }

          const { success, error } = await deleteFromCloudinary(datos.publicId, datos.resourceType);
          if (!success) {
            console.error(`No se pudo borrar de Cloudinary la imagen ${datos.publicId}:`, error);
          }
        }),
      );
    }

    const advertencia = publicacionesFallidas.length
      ? `${publicacionesFallidas.length === 1 ? "1 publicación" : `${publicacionesFallidas.length} publicaciones`} de MercadoLibre no se pudo eliminar y sigue activa allá — revisala desde el módulo de Publicaciones.`
      : null;

    return res.status(201).json({ status: 201, resp: venta, advertencia });
  } catch (error) {
    return res.status(500).json({ status: "500", resp: error.message });
  }
};

module.exports = createVenta;
