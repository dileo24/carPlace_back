const { ConsultaHistorial, Consulta } = require("../../../db");

const ROLES_FULL_ACCESS = ["admin", "supervisor"];

const updateConsultaHistorial = async (req, res) => {
  try {
    const { id, entradaId } = req.params;
    const rol = req.user?.rol || "";
    const userId = req.user?.id ?? null;
    const esAdmin = ROLES_FULL_ACCESS.includes(rol);

    const entrada = await ConsultaHistorial.findOne({
      where: { id: entradaId, consultaId: id },
    });
    if (!entrada) return res.status(404).json({ status: 404, error: "Entrada no encontrada" });

    if (!esAdmin) {
      // Puede editar si: es el creador de la nota O es el asesor asignado a la consulta
      const consulta = await Consulta.findByPk(id, { attributes: ["asesorId"] });
      const esCreador = entrada.creadoPorId === userId;
      const esAsesor = consulta?.asesorId === userId;

      if (!esCreador && !esAsesor) {
        return res.status(403).json({ status: 403, error: "Sin permiso para editar esta nota" });
      }
    }

    const { texto } = req.body;
    if (!texto?.trim())
      return res.status(400).json({ status: 400, error: "El texto no puede estar vacío" });

    await entrada.update({ texto: texto.trim() });
    return res.status(200).json({ status: 200, resp: entrada });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = updateConsultaHistorial;
