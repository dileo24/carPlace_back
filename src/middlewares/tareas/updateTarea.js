// controllers/tareas/updateTarea.js
const { Tarea } = require("../../db");

/**
 * PUT /tareas/:id
 *
 * Acepta cualquier subconjunto de campos editables.
 * Las notas se reemplazan completas (el front manda el array actualizado).
 *
 * Body ejemplo:
 * {
 *   titulo, tipo, prioridad, descripcion,   // edición general
 *   estado,                                                    // cambio de estado
 *   notas: [{ id, texto, autor, creadoEn }]                   // array completo
 * }
 */
const updateTarea = async (req, res) => {
  try {
    const { id } = req.params;

    const tarea = await Tarea.findByPk(id);
    if (!tarea) {
      return res.status(404).json({ error: `Tarea con id ${id} no encontrada.` });
    }
    const userId = req.user?.id ?? null;
    const rol = req.user?.rol || "";

    if (
      ["admin", "supervisor", "socio"].includes(rol) &&
      tarea.creadoPorId &&
      tarea.creadoPorId !== userId
    ) {
      return res.status(403).json({ error: "No tenés permiso para modificar esta tarea." });
    }
    const CAMPOS_PERMITIDOS = ["titulo", "tipo", "prioridad", "estado", "descripcion", "notas"];

    const actualizaciones = {};
    for (const campo of CAMPOS_PERMITIDOS) {
      if (req.body[campo] !== undefined) {
        actualizaciones[campo] = req.body[campo];
      }
    }

    if (Object.keys(actualizaciones).length === 0) {
      return res.status(400).json({ error: "No se enviaron campos para actualizar." });
    }

    await tarea.update(actualizaciones);

    res.status(200).json({ status: 200, resp: tarea });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = updateTarea;
