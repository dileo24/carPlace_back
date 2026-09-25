const { AutoTareaAlistaje } = require("../../../db");
const { parsearEnteroLimpio } = require("../../../services/formatearAuto");

const syncTareasAlistaje = async (req, res) => {
  try {
    const { id } = req.params;
    const { tareas } = req.body; // array de { id?, texto, hecha, orden }

    if (!Array.isArray(tareas)) {
      return res.status(400).json({ status: "400", resp: "El campo tareas debe ser un array." });
    }

    // IDs que manda el front (solo los que ya existen en la DB)
    const idsEntrantes = tareas.filter(t => typeof t.id === "number").map(t => t.id);

    // Borrar las que ya no están en el array
    await AutoTareaAlistaje.destroy({
      where: {
        autoId: id,
        ...(idsEntrantes.length > 0 && {
          id: { [require("sequelize").Op.notIn]: idsEntrantes },
        }),
        // Si no vienen IDs numéricos, borra todas las existentes
        ...(idsEntrantes.length === 0 && {}),
      },
    });

    if (idsEntrantes.length === 0) {
      await AutoTareaAlistaje.destroy({ where: { autoId: id } });
    }

    const resultado = [];

    for (let i = 0; i < tareas.length; i++) {
      const t = tareas[i];
      const datos = {
        texto: t.texto?.trim() ?? "",
        hecha: t.hecha ?? false,
        orden: i, // el orden lo define la posición en el array
        precio: t.precio !== undefined ? parsearEnteroLimpio(t.precio) : null,
      };

      if (typeof t.id === "number") {
        // Actualizar existente
        const existente = await AutoTareaAlistaje.findOne({
          where: { id: t.id, autoId: id },
        });
        if (existente) {
          await existente.update(datos);
          resultado.push(existente);
        }
      } else {
        // Crear nueva
        const nueva = await AutoTareaAlistaje.create({ autoId: Number(id), ...datos });
        resultado.push(nueva);
      }
    }
    const hayPendientes = tareas.some(t => !t.hecha);
    await require("../../../db").Auto.update({ en_alistaje: hayPendientes }, { where: { id } });
    return res.status(200).json({ status: 200, resp: resultado });
  } catch (error) {
    return res.status(500).json({ status: "500", resp: error.message });
  }
};

module.exports = syncTareasAlistaje;
