const { Conversacion, Consulta, ConsultaHistorial } = require("../../../db");
const { buscarConsultaActiva } = require("../../../services/consultasHelper");
const normalizarTelefono = require("../../../services/normalizarTelefono");
const { programarSeguimiento } = require("../../../cronjobs/seguimientoPresencial");

const generarConsulta = async (req, res) => {
  try {
    const conv = await Conversacion.findByPk(req.params.id);
    if (!conv) return res.status(404).json({ status: 404, error: "Conversación no encontrada" });
    if (conv.consultaId)
      return res
        .status(400)
        .json({ status: 400, error: "Ya existe una consulta para esta conversación" });

    const telefonoNormalizado = conv.telefono ? normalizarTelefono(conv.telefono) : null;

    if (telefonoNormalizado) {
      const consultaExistente = await buscarConsultaActiva(telefonoNormalizado);
      if (consultaExistente) {
        return res.status(409).json({
          status: 409,
          error: `Ya existe una consulta activa (#${consultaExistente.id}) con ese teléfono. Vinculala en vez de crear una nueva.`,
        });
      }
    }

    let perfil = conv.perfil || {};
    if (typeof perfil === "string") {
      try {
        perfil = JSON.parse(perfil);
      } catch {
        perfil = {};
      }
    }

    // Si el bot todavía no completó perfil.vehiculo (por ejemplo, derivó con
    // derivarHumano hace instantes y generarResumen sigue corriendo en segundo
    // plano), forzamos una pasada síncrona acá para no crear la consulta con
    // el dato vacío por una simple carrera de timing.
    if (!perfil.vehiculo?.modelo) {
      try {
        const generarResumen = require("../../../bot/generarResumen");
        await generarResumen(conv.id);
        await conv.reload();
        perfil = conv.perfil || {};
        if (typeof perfil === "string") {
          try {
            perfil = JSON.parse(perfil);
          } catch {
            perfil = {};
          }
        }
      } catch (e) {
        console.warn("⚠️ No se pudo regenerar resumen antes de crear consulta:", e.message);
      }
    }

    const splitNombreApellido = require("../../../services/splitNombreApellido");
    const { nombre: nombreLimpio, apellido: apellidoLimpio } = splitNombreApellido(
      conv.contactoNombre,
      conv.contactoApellido,
    );
    const rawFormaPago = perfil.financiacion ? "financiado" : "a_definir";
    const consulta = await Consulta.create({
      nombre: nombreLimpio,
      apellido: apellidoLimpio,
      telefono: telefonoNormalizado,
      vehiculo: perfil.vehiculo?.modelo || null,
      categoria: perfil.vehiculo?.categoria || null,
      formaPago: [rawFormaPago],
      origen: conv.canal,
      estado: "nuevo",
      cargadoPor: "bot",
      asesorId: conv.asesorId || null,
      asesorNombre: conv.asesorNombre || null,
      asesorApellido: conv.asesorApellido || null,
      notas: conv.resumenIA || null,
      estadoCambiadoEn: new Date(),
    });

    await ConsultaHistorial.create({
      tipo: "sistema",
      texto: `Consulta creada desde conversación #${conv.id} con estado "Nuevo".`,
      consultaId: consulta.id,
      conversacionId: conv.id,
    });

    const { backfillNotasConversacion } = require("../../../services/backfillNotasConversacion");
    await backfillNotasConversacion(conv.id, consulta.id);

    try {
      programarSeguimiento(consulta.toJSON());
    } catch (e) {
      console.warn("⚠️ No se pudo programar seguimiento:", e.message);
    }

    await conv.update({ consultaId: consulta.id });

    try {
      const { getIO } = require("../../../bot/socket");
      getIO().emit("conversacion:actualizada", {
        conversacionId: conv.id,
        consultaId: consulta.id,
      });
    } catch (_) {}

    return res.status(201).json({ status: 201, resp: consulta });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = generarConsulta;
