const { Op } = require("sequelize");
const { Auto, Categoria } = require("../../db");
const { formatearAutoParaRespuesta } = require("../../services/formatearAuto");

const getAutosDestacados = async (req, res, next) => {
  try {
    const autosDestacados = await Auto.findAll({
      where: { destacar: true, visible: true, estado: { [Op.ne]: "no_disponible" } },
      include: [
        {
          model: Categoria,
          as: "categorias",
          through: { attributes: [] },
        },
      ],
      order: [["precio", "ASC"]],
    });

    const autosConImgsParseadas = autosDestacados.map(a => formatearAutoParaRespuesta(a, { publico: true }));

    res.status(200).json({
      status: 200,
      resp: autosConImgsParseadas,
    });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
};

module.exports = getAutosDestacados;