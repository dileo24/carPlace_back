const { Configuracion } = require("../../../db");

const updateConfiguracion = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    if (rol !== "admin") return res.status(403).json({ status: 403, error: "Sin acceso" });

    const { clave } = req.params;
    const { valor } = req.body;

    const [config] = await Configuracion.upsert({ clave, valor });
    return res.status(200).json({ status: 200, resp: config.valor ?? valor });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = updateConfiguracion;