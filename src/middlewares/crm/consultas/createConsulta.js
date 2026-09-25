const { Consulta, ConsultaHistorial, Conversacion, User } = require("../../../db");
const { Op } = require("sequelize");
const { programarSeguimiento } = require("../../../cronjobs/seguimientoPresencial");
const { variantesTelefono, buscarConsultaActiva } = require("../../../services/consultasHelper");
const normalizarTelefono = require("../../../services/normalizarTelefono");

const createConsulta = async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.telefono) body.telefono = normalizarTelefono(body.telefono);

    if (body.asesorId) {
      const asesor = await User.findByPk(Number(body.asesorId));
      if (asesor) {
        const partes = (asesor.name || "").split(" ");
        body.asesorNombre = partes[0] ?? null;
        body.asesorApellido = partes.slice(1).join(" ") || null;
      }
    }

    if (body.formaPago) {
      if (typeof body.formaPago === "string") {
        try {
          body.formaPago = JSON.parse(body.formaPago);
        } catch {
          body.formaPago = [body.formaPago];
        }
      }
      if (!Array.isArray(body.formaPago)) {
        body.formaPago = [body.formaPago];
      }
    }

    let conversacionVinculada = null;
    if (body.telefono) {
      const consultaExistente = await buscarConsultaActiva(body.telefono);
      if (consultaExistente) {
        return res.status(409).json({
          status: 409,
          error: `Ya existe una consulta activa (#${consultaExistente.id}) con ese teléfono.`,
        });
      }

      const variantes = variantesTelefono(body.telefono);
      conversacionVinculada = await Conversacion.findOne({
        where: { telefono: { [Op.in]: variantes } },
      });
    }

    const consulta = await Consulta.create({
      ...body,
      estadoCambiadoEn: new Date(),
    });

    if (conversacionVinculada) {
      await conversacionVinculada.update({
        consultaId: consulta.id,
        contactoNombre: consulta.nombre || conversacionVinculada.contactoNombre,
        contactoApellido: consulta.apellido || conversacionVinculada.contactoApellido,
      });
      try {
        const { getIO } = require("../../../bot/socket");
        getIO().emit("conversacion:actualizada", {
          conversacionId: conversacionVinculada.id,
          consultaId: consulta.id,
        });
      } catch (_) {}
    }

    await ConsultaHistorial.create({
      tipo: "sistema",
      texto: `Consulta creada con estado "Nuevo".`,
      consultaId: consulta.id,
    });
    programarSeguimiento(consulta.toJSON());

    return res.status(201).json({
      status: 201,
      resp: { ...consulta.toJSON(), conversacionId: conversacionVinculada?.id || null },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = createConsulta;
