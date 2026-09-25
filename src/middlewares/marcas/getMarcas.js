const { Marca, Auto } = require("../../db");
const { Sequelize } = require("sequelize");

// GET /marcas — catálogo completo, lo usan tanto el admin (módulo de gestión)
// como el sitio público (carrusel y filtro de marcas).
const getMarcas = async (req, res) => {
  try {
    const marcas = await Marca.findAll({ order: [["nombre", "ASC"]] });

    // Conteo de autos en el stock real (todos los estados/visibilidad, no
    // solo los disponibles/visibles), agrupado case-insensitive por marca
    // para que coincida con el match que ya usa getAutosPorMarca.js.
    const conteos = await Auto.findAll({
      attributes: [
        [Sequelize.fn("LOWER", Sequelize.col("marca")), "marcaLower"],
        [Sequelize.fn("COUNT", Sequelize.col("id")), "total"],
      ],
      group: [Sequelize.fn("LOWER", Sequelize.col("marca"))],
      raw: true,
    });
    const totalesPorMarca = new Map(conteos.map((c) => [c.marcaLower, Number(c.total)]));

    const resp = marcas.map((m) => ({
      ...m.toJSON(),
      totalAutos: totalesPorMarca.get(m.nombre.toLowerCase()) || 0,
    }));

    res.status(200).json({ status: 200, resp });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = getMarcas;
