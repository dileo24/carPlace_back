// controllers/tareas/createTarea.js
const { Tarea } = require("../../db");

const createTarea = async (req, res) => {
  try {
    const { titulo, tipo, prioridad, descripcion, creadoPor } = req.body;
    const userId = req.user?.id ?? null;

    if (!titulo || !tipo || !prioridad) {
      return res.status(400).json({ error: "titulo, tipo y prioridad son requeridos." });
    }

    const tarea = await Tarea.create({
      titulo,
      tipo,
      prioridad,
      descripcion: descripcion || null,
      creadoPor: creadoPor || "usuario",
      creadoPorId: userId,
      estado: "pendiente",
      notas: [],
    });

    res.status(201).json({ status: 201, resp: tarea });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = createTarea;