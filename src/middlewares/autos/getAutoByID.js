const { Auto, Categoria, AutoTareaAlistaje } = require("../../db");
const { formatearAutoParaRespuesta } = require("../../services/formatearAuto");

const getAutoById = async (req, res) => {
  try {
    const { id } = req.params;
    const auto = await Auto.findByPk(id, {
      include: [
        {
          model: Categoria,
          as: "categorias",
          through: { attributes: [] },
        },
        {
          model: AutoTareaAlistaje,
          as: "tareasAlistaje",
          order: [["orden", "ASC"]],
        },
      ],
    });

    if (!auto) {
      return res.status(404).json({ error: "Auto no encontrado" });
    }

    // Mismo criterio de visibilidad pública que allAutos.js aplica en el
    // listado (visible=true, estado != no_disponible) — si no, un auto oculto
    // o dado de baja queda igual accesible por link directo al id, aunque
    // nunca aparezca en el catálogo. El staff logueado (cualquier rol) sí
    // puede seguir previsualizándolo.
    const esPublico = !req.user;
    if (esPublico && (auto.visible === false || auto.estado === "no_disponible")) {
      return res.status(404).json({ error: "Auto no encontrado" });
    }

    // El socio no puede ver por link directo un auto que no es suyo ni
    // compartido (mismo alcance que el listado en allAutos.js).
    if (req.user?.rol === "socio" && !["socio", "compartido"].includes(auto.propietario)) {
      return res.status(404).json({ error: "Auto no encontrado" });
    }

    const autoObj = formatearAutoParaRespuesta(auto, { publico: esPublico });

    res.status(200).json({ status: 200, resp: autoObj });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = getAutoById;
