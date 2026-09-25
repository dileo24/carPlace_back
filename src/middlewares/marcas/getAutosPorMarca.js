const { Marca, Auto } = require("../../db");
const { Sequelize } = require("sequelize");

// GET /marcas/:id/autos — autos cargados con esta marca (match case-insensitive
// contra Auto.marca, que es un string libre sin FK). Solo lo mínimo para
// identificar el auto en el desplegable del admin: modelo y año.
const getAutosPorMarca = async (req, res) => {
  try {
    const marca = await Marca.findByPk(req.params.id);
    if (!marca) return res.status(404).json({ status: 404, error: "Marca no encontrada" });

    const autos = await Auto.findAll({
      where: Sequelize.where(Sequelize.fn("LOWER", Sequelize.col("marca")), marca.nombre.toLowerCase()),
      attributes: ["id", "modelo", "anio"],
      order: [["modelo", "ASC"]],
    });

    res.status(200).json({ status: 200, resp: autos });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = getAutosPorMarca;
