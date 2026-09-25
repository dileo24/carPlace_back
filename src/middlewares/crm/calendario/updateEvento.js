const { EventoCalendario, User, ConsultaHistorial, Conversacion } = require("../../../db");
const { getIO } = require("../../../bot/socket");
const { notificarAdmin } = require("../../../services/notificacionAdmin");
const { Op } = require("sequelize");
const normalizarTelefono = require("../../../services/normalizarTelefono");
const { obtenerTodosLosUsuarioIds } = require("../../../services/eventoHelper");
const { variantesTelefono } = require("../../../services/consultasHelper");

const CAMPOS_PERMITIDOS = [
  "titulo",
  "tipo",
  "tipoPersonalizado",
  "fecha",
  "horaInicio",
  "estado",
  "clienteNombre",
  "clienteApellido",
  "clienteTelefono",
  "vehiculo",
  "usuarioId",
  "invitadosIds",
  "notas",
  "notasFinalizacion",
];

const updateEvento = async (req, res) => {
  try {
    const { id } = req.params;

    const evento = await EventoCalendario.findByPk(id);

    if (!evento) {
      return res.status(404).json({
        status: 404,
        error: "Evento no encontrado",
      });
    }
    const rol = req.user?.rol || "";
    const userId = req.user?.id ?? null;

    if (rol !== "admin") {
      const esCreador = evento.creadoPorId === userId;
      const esResponsable = evento.usuarioId === userId;
      const esInvitado = (evento.invitadosIds ?? []).includes(userId);
      if (!esCreador && !esResponsable && !esInvitado) {
        return res
          .status(403)
          .json({ status: 403, error: "No tenés permiso para modificar este evento." });
      }
    }

    const datos = {};
    for (const campo of CAMPOS_PERMITIDOS) {
      if (req.body[campo] !== undefined) {
        datos[campo] = req.body[campo];
      }
    }
    if (datos.clienteTelefono) {
      datos.clienteTelefono = normalizarTelefono(datos.clienteTelefono);
    }

    // ── Si el tipo cambia A "visita" (no estaba antes), invitar a todos ──
    const tipoAnterior = evento.tipo;
    const tipoNuevo = datos.tipo ?? tipoAnterior;
    if (tipoNuevo === "visita" && tipoAnterior !== "visita") {
      datos.invitadosIds = await obtenerTodosLosUsuarioIds();
    }

    const notasAnterior = evento.notas;
    const notasFinalizacionAnterior = evento.notasFinalizacion;

    await evento.update(datos);

    // ── Si se cargó/corrigió el teléfono y el evento todavía no tenía chat
    //    vinculado, intentamos engancharlo con una conversación existente ──
    if (datos.clienteTelefono && !evento.conversacionId) {
      try {
        const variantes = variantesTelefono(datos.clienteTelefono);
        const convExistente = variantes.length
          ? await Conversacion.findOne({ where: { telefono: { [Op.in]: variantes } } })
          : null;
        if (convExistente) {
          await evento.update({ conversacionId: convExistente.id });
        }
      } catch (_) {}
    }

    // ── Reflejar notas del evento en el historial de la consulta vinculada,
    //    para que ambas pantallas muestren la misma información (si vino,
    //    si le interesó, etc.) sin tener que cargarla dos veces ──────────────
    if (evento.consultaId) {
      const fechaHora = `${evento.fecha} ${evento.horaInicio}hs`;
      if (
        datos.notasFinalizacion !== undefined &&
        datos.notasFinalizacion &&
        datos.notasFinalizacion !== notasFinalizacionAnterior
      ) {
        await ConsultaHistorial.create({
          consultaId: evento.consultaId,
          tipo: "visita",
          texto: `Cierre de visita (${fechaHora}): ${datos.notasFinalizacion}`,
          creadoPorId: userId,
        });
      }
      if (datos.notas !== undefined && datos.notas && datos.notas !== notasAnterior) {
        await ConsultaHistorial.create({
          consultaId: evento.consultaId,
          tipo: "visita",
          texto: `Nota de la visita (${fechaHora}): ${datos.notas}`,
          creadoPorId: userId,
        });
      }
    }

    try {
      getIO().emit("calendario:actualizado");
    } catch (_) {}

    // ── Resolver nombres igual que en getEventos ──────────────────────────────
    const plain = evento.toJSON();
    const userIdSet = new Set();
    if (plain.usuarioId) userIdSet.add(plain.usuarioId);
    if (plain.creadoPorId) userIdSet.add(plain.creadoPorId);
    for (const id of plain.invitadosIds ?? []) userIdSet.add(id);

    const usuarioMap = {};
    if (userIdSet.size > 0) {
      const usuarios = await User.findAll({
        where: { id: { [Op.in]: [...userIdSet] } },
        attributes: ["id", "name"],
      });
      for (const u of usuarios) usuarioMap[u.id] = u.name;
    }

    const resp = {
      ...plain,
      usuarioNombre: usuarioMap[plain.usuarioId] ?? null,
      creadoPorNombre: usuarioMap[plain.creadoPorId] ?? null,
      invitados: (plain.invitadosIds ?? []).map(id => ({
        id,
        name: usuarioMap[id] ?? null,
      })),
    };

    // ── Notificar al admin ────────────────────────────────────────────────────
    // No notificar si solo cambió el estado (confirmaciones, cancelaciones — ya
    // tienen su propio flujo de notificación en el bot y en recordatorioVisitas)
    const soloEstado = Object.keys(datos).length === 1 && datos.estado !== undefined;
    if (!soloEstado) {
      const vendedorNombre = req.user?.nombre || "";
      const vendedorApellido = req.user?.apellido || "";
      const fechaStr = plain.fecha
        ? new Date(`${plain.fecha}T00:00:00`).toLocaleDateString("es-AR", {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })
        : "Fecha no definida";
      const cliente = [plain.clienteNombre, plain.clienteApellido].filter(Boolean).join(" ");

      notificarAdmin(
        `✏️ *Visita modificada desde el CRM*\n` +
          `👤 Vendedor: ${vendedorNombre} ${vendedorApellido}\n` +
          `🏷️ ${plain.titulo || "Sin título"}\n` +
          `🗓️ ${fechaStr} a las ${plain.horaInicio || "??"} hs\n` +
          (cliente ? `🙋 Cliente: ${cliente}\n` : "") +
          (plain.vehiculo ? `🚗 ${plain.vehiculo}\n` : "") +
          (plain.notas ? `📝 ${plain.notas}\n` : ""),
      ).catch(() => {}); // fire and forget — no bloquea la respuesta
    }

    res.status(200).json({ status: 200, resp });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: 500,
      error: error.message,
    });
  }
};

module.exports = updateEvento;
