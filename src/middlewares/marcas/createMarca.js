const { Marca } = require("../../db");
const { Sequelize } = require("sequelize");

// POST /marcas — la foto ya se subió antes vía POST /files (mismo endpoint
// genérico que usan las fotos de autos); acá solo se guarda la referencia.
const createMarca = async (req, res) => {
  try {
    const { nombre, fotoUrl, fotoPublicId } = req.body;
    if (!nombre?.trim()) {
      return res.status(400).json({ status: 400, error: "El nombre es requerido" });
    }

    const yaExiste = await Marca.findOne({
      where: Sequelize.where(Sequelize.fn("LOWER", Sequelize.col("nombre")), nombre.trim().toLowerCase()),
    });
    if (yaExiste) {
      return res.status(409).json({ status: 409, error: "Ya existe una marca con ese nombre" });
    }

    const marca = await Marca.create({
      nombre: nombre.trim(),
      fotoUrl: fotoUrl || null,
      fotoPublicId: fotoPublicId || null,
    });

    res.status(201).json({ status: 201, resp: marca });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = createMarca;
