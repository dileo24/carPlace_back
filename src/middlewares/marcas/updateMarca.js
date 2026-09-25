const { Marca, Auto, conn } = require("../../db");
const { Sequelize } = require("sequelize");
const { deleteFromCloudinary } = require("../../services/cloudinaryService");

// PUT /marcas/:id
// Si el nombre cambia, actualiza en cascada el string `marca` de todos los
// autos que tenían el nombre viejo (match case-insensitive), para que el
// catálogo (selector de autos, carrusel, filtros) no se desincronice — Auto
// no tiene FK a Marca, el vínculo es por texto.
const updateMarca = async (req, res) => {
  try {
    const marca = await Marca.findByPk(req.params.id);
    if (!marca) return res.status(404).json({ status: 404, error: "Marca no encontrada" });

    const { nombre, fotoUrl, fotoPublicId } = req.body;
    const nombreNuevo = nombre?.trim();
    if (!nombreNuevo) {
      return res.status(400).json({ status: 400, error: "El nombre es requerido" });
    }

    if (nombreNuevo.toLowerCase() !== marca.nombre.toLowerCase()) {
      const otraConEseNombre = await Marca.findOne({
        where: Sequelize.where(Sequelize.fn("LOWER", Sequelize.col("nombre")), nombreNuevo.toLowerCase()),
      });
      if (otraConEseNombre && otraConEseNombre.id !== marca.id) {
        return res.status(409).json({ status: 409, error: "Ya existe una marca con ese nombre" });
      }
    }

    const nombreViejo = marca.nombre;
    const fotoPublicIdViejo = marca.fotoPublicId;

    await conn.transaction(async t => {
      await marca.update(
        {
          nombre: nombreNuevo,
          ...(fotoUrl !== undefined && { fotoUrl }),
          ...(fotoPublicId !== undefined && { fotoPublicId }),
        },
        { transaction: t },
      );

      if (nombreNuevo.toLowerCase() !== nombreViejo.toLowerCase()) {
        await Auto.update(
          { marca: nombreNuevo },
          {
            where: Sequelize.where(Sequelize.fn("LOWER", Sequelize.col("marca")), nombreViejo.toLowerCase()),
            transaction: t,
          },
        );
      }
    });

    // Si se reemplazó la foto, borrar la anterior de Cloudinary (best-effort,
    // no bloquea la respuesta si falla — mismo criterio que updateAuto.js).
    if (fotoPublicId !== undefined && fotoPublicIdViejo && fotoPublicIdViejo !== fotoPublicId) {
      const publicId = `general/${fotoPublicIdViejo}`;
      const { success, error } = await deleteFromCloudinary(publicId);
      if (!success) {
        console.error(`No se pudo borrar de Cloudinary la foto vieja de marca ${publicId}:`, error);
      }
    }

    res.status(200).json({ status: 200, resp: marca });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = updateMarca;
