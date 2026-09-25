const { Configuracion } = require("../../../db");

const getConfiguracion = async (req, res) => {
  try {
    const { clave } = req.params;
    const config = await Configuracion.findOne({ where: { clave } });
    if (!config) return res.status(404).json({ status: 404, error: "Configuración no encontrada" });
    return res.status(200).json({ status: 200, resp: config.valor });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = getConfiguracion;