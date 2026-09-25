const { EventoCalendario, User, Conversacion, Consulta } = require("../../../db");
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
  "clienteNombre",
  "clienteApellido",
  "clienteTelefono",
  "vehiculo",
  "usuarioId",
  "invitadosIds",
  "notas",
];

const createEvento = async (req, res) => {
  try {
    const datos = {};
    for (const campo of CAMPOS_PERMITIDOS) {
      if (req.body[campo] !== undefined) {
        datos[campo] = req.body[campo];
      }
    }

    const rol = req.user?.rol || "";
    const userId = req.user?.id ?? null;

    if (userId) {
      datos.creadoPorId = userId;
      datos.creadoPorRol = rol ?? null;
    }
    if (datos.clienteTelefono) {
      datos.clienteTelefono = normalizarTelefono(datos.clienteTelefono);
    }

    // ── Si el evento es de tipo "visita" (explícito o por default del modelo),
    //    invitar automáticamente a todos los usuarios ──
    const tipoEfectivo = datos.tipo ?? "visita";
    if (tipoEfectivo === "visita") {
      datos.invitadosIds = await obtenerTodosLosUsuarioIds();
    }

    const nuevoEvento = await EventoCalendario.create(datos);

    // ── Si ya existe una conversación de WhatsApp con este teléfono (ej: el
    //    cliente ya había escrito antes por otro motivo), la vinculamos acá
    //    mismo — si no, "ver chat" queda apuntando a nada hasta que alguien
    //    la genere manualmente ──────────────────────────────────────────────
    if (nuevoEvento.clienteTelefono) {
      try {
        const variantes = variantesTelefono(nuevoEvento.clienteTelefono);
        const convExistente = variantes.length
          ? await Conversacion.findOne({ where: { telefono: { [Op.in]: variantes } } })
          : null;
        if (convExistente) {
          await nuevoEvento.update({ conversacionId: convExistente.id });
        }
      } catch (_) {}
    }

    // ── Si el usuario confirmó explícitamente asociar una consulta activa
    //    existente para este teléfono (aviso del formulario de nueva visita),
    //    la vinculamos — validando que el teléfono coincida, para que no se
    //    pueda enganchar un consultaId arbitrario de otro cliente ──────────
    if (req.body.consultaId && nuevoEvento.clienteTelefono) {
      try {
        const variantes = variantesTelefono(nuevoEvento.clienteTelefono);
        const consulta = variantes.length
          ? await Consulta.findOne({
              where: { id: req.body.consultaId, telefono: { [Op.in]: variantes } },
            })
          : null;
        if (consulta) {
          await nuevoEvento.update({ consultaId: consulta.id });
        }
      } catch (_) {}
    }

    // ── Resolver nombres ──────────────────────────────────────────────────────
    const plain = nuevoEvento.toJSON();
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

    try {
      getIO().emit("calendario:actualizado");
    } catch (_) {}

    // ── Notificar al admin ────────────────────────────────────────────────────
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
    if (rol !== "admin") {
      notificarAdmin(
        `📅 *Nueva visita agendada desde el CRM*\n` +
          `👤 Vendedor: ${vendedorNombre} ${vendedorApellido}\n` +
          `🏷️ ${plain.titulo || "Sin título"}\n` +
          `🗓️ ${fechaStr} a las ${plain.horaInicio || "??"} hs\n` +
          (cliente ? `🙋 Cliente: ${cliente}\n` : "") +
          (plain.vehiculo ? `🚗 ${plain.vehiculo}\n` : "") +
          (plain.notas ? `📝 ${plain.notas}\n` : ""),
      ).catch(() => {}); // fire and forget — no bloquea la respuesta
    }
    res.status(201).json({ status: 201, resp });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: 500,
      error: error.message,
    });
  }
};

module.exports = createEvento;
