const { Consulta, ConsultaHistorial, User, Conversacion } = require("../../../db");
const { buscarConsultaActiva } = require("../../../services/consultasHelper");
const normalizarTelefono = require("../../../services/normalizarTelefono");

const ROLES_FULL_ACCESS = ["admin", "supervisor"];

const CAMPOS_PERMITIDOS_VENDEDOR = [
  "vehiculo",
  "categoria",
  "presupuesto",
  "formaPago",
  "estado",
  "notas",
  "motivo",
  "calificado",
  "asesorId",
  "asesorNombre",
  "asesorApellido",
];

const ESTADO_LABEL = {
  nuevo: "Nuevo",
  con_oferta: "Con oferta",
  seguimiento: "Seguimiento",
  cerrado: "Cerrado",
  perdido: "Perdido",
};

const updateConsulta = async (req, res) => {
  try {
    const { id } = req.params;
    const rol = req.user?.rol || "";
    const userId = req.user?.id ?? null;
    const esAdmin = ROLES_FULL_ACCESS.includes(rol);
    const body = req.body;

    const consulta = await Consulta.findByPk(id);
    if (!consulta) {
      return res.status(404).json({ status: 404, error: "Consulta no encontrada" });
    }

    const sinAsesor = !consulta.asesorId;
    if (!esAdmin && !sinAsesor && String(consulta.asesorId) !== String(userId)) {
      return res.status(403).json({ status: 403, error: "Sin acceso a esta consulta" });
    }

    let actualizaciones = body;
    if (!esAdmin) {
      actualizaciones = Object.fromEntries(
        Object.entries(body).filter(([k]) => CAMPOS_PERMITIDOS_VENDEDOR.includes(k)),
      );
    }

    // normalizar antes de comparar o guardar
    if (actualizaciones.telefono) {
      actualizaciones.telefono = normalizarTelefono(actualizaciones.telefono);
    }
    // ── Validar teléfono duplicado si se está cambiando ──────────────────
    if (actualizaciones.telefono && actualizaciones.telefono !== consulta.telefono) {
      const consultaConflicto = await buscarConsultaActiva(actualizaciones.telefono, {
        excludeId: consulta.id,
      });
      if (consultaConflicto) {
        return res.status(409).json({
          status: 409,
          error: `Ya existe una consulta activa (#${consultaConflicto.id}) con ese teléfono.`,
        });
      }
    }

    if (actualizaciones.estado && actualizaciones.estado !== consulta.estado) {
      actualizaciones.estadoCambiadoEn = new Date();
      await ConsultaHistorial.create({
        tipo: "sistema",
        texto: `Estado cambiado de "${ESTADO_LABEL[consulta.estado]}" a "${ESTADO_LABEL[actualizaciones.estado]}".`,
        consultaId: id,
      });
    }

    if (actualizaciones.asesorId) {
      actualizaciones.asesorId = Number(actualizaciones.asesorId);
      const asesor = await User.findByPk(actualizaciones.asesorId);
      if (asesor) {
        const partes = (asesor.name || "").split(" ");
        actualizaciones.asesorNombre = partes[0] ?? null;
        actualizaciones.asesorApellido = partes.slice(1).join(" ") || null;
      }
    } else if (actualizaciones.asesorId === null) {
      actualizaciones.asesorNombre = null;
      actualizaciones.asesorApellido = null;
    }

    // ── Sincronizar conversación vinculada si cambia el teléfono ─────────
    const telefonoViejo = consulta.telefono;
    const telefonoCambio = actualizaciones.telefono && actualizaciones.telefono !== telefonoViejo;

    await consulta.update(actualizaciones);

    if (telefonoCambio) {
      try {
        const conv = await Conversacion.findOne({ where: { consultaId: consulta.id } });
        if (conv) {
          await conv.update({ telefono: normalizarTelefono(actualizaciones.telefono) });
          console.log(
            `🔄 Teléfono de conv ${conv.id} sincronizado tras editar consulta ${consulta.id}`,
          );
        }
      } catch (e) {
        console.warn(`⚠️ No se pudo sincronizar teléfono de conversación:`, e.message);
      }
    }

    // Cerrar conversación asociada si la consulta se cierra o se pierde
    if (
      actualizaciones.estado &&
      ["cerrado", "perdido"].includes(actualizaciones.estado) &&
      actualizaciones.estado !== consulta.estado
    ) {
      try {
        const { Conversacion } = require("../../../db");
        const { getIO } = require("../../../bot/socket");

        const conv = await Conversacion.findOne({
          where: { consultaId: consulta.id },
        });

        if (conv && conv.estado !== "cerrada") {
          await conv.update({ estado: "cerrada" });
          try {
            getIO().emit("conversacion:estadoCambiado", {
              conversacionId: conv.id,
              estado: "cerrada",
              asesorNombre: null,
              asesorApellido: null,
            });
          } catch (_) {}
          console.log(
            `🔒 Conversación ${conv.id} cerrada automáticamente por cierre de consulta ${consulta.id}`,
          );
        }
      } catch (err) {
        console.warn("⚠️ No se pudo cerrar la conversación asociada:", err.message);
      }
    }

    // Re-fetch con historial incluido
    const consultaActualizada = await Consulta.findByPk(id, {
      include: [{ association: "historial", order: [["createdAt", "ASC"]] }],
    });

    return res.status(200).json({ status: 200, resp: consultaActualizada });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = updateConsulta;
