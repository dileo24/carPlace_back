const cron = require("node-cron");
const { EventoCalendario, Conversacion, Mensaje, CronLog } = require("../db");
const { Op } = require("sequelize");
const { sendWhatsAppMessage, sendWhatsAppTemplate } = require("../services/whatsapp");
const { logCron, limpiarCronLogs } = require("../services/cronLog");
const { getIO } = require("../bot/socket");
const hoyArgentina = require("../services/hoyArgentina");

let corrioHoy = false;

const enviarRecordatorios = async () => {
  await limpiarCronLogs();
  try {
    const hoy = hoyArgentina();
    const ahora = new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Cordoba" });
    const horaActual = new Date(ahora).toTimeString().slice(0, 5);

    const eventos = await EventoCalendario.findAll({
      where: {
        fecha: hoy,
        estado: { [Op.in]: ["pendiente", "confirmada"] },
        clienteTelefono: { [Op.not]: null },
        tipo: "visita",
        horaInicio: { [Op.gt]: horaActual },
      },
    });

    console.log(`🗓️ Recordatorios: ${eventos.length} eventos para hoy`);

    for (const evento of eventos) {
      let telefono = evento.clienteTelefono;
      telefono = telefono.replace(/\D/g, "");

      if (telefono.startsWith("549")) {
        // ok
      } else if (telefono.startsWith("54")) {
        telefono = "549" + telefono.slice(2);
      } else if (telefono.length === 10) {
        telefono = "549" + telefono;
      } else if (telefono.length === 7 || telefono.length === 8) {
        console.warn(`⚠️ Teléfono demasiado corto para normalizar: ${telefono}, se omite`);
        continue;
      } else {
        telefono = "549" + telefono;
      }

      const nombre = evento.clienteNombre || "cliente";
      const fecha = new Date(evento.fecha + "T00:00:00").toLocaleDateString("es-AR", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
      });
      const hora = evento.horaInicio;
      const vehiculo = evento.vehiculo ? ` para ver el ${evento.vehiculo}` : "";

      const mensajeLibre =
        `Car Place\n` +
        `Av. Caraffa 2247\n\n` +
        `🙌 Buenos días, ${nombre}!\n\n` +
        `🗓️ Le recordamos su visita${vehiculo} para hoy ${fecha} a las ${hora} hs.\n\n` +
        `Por favor confírmenos su asistencia respondiendo este mensaje.\n\n` +
        `¡Que tenga un lindo día! ☀️`;

      try {
        try {
          console.log("Enviando template a", telefono, {
            customer_name: nombre,
            visit_date: fecha,
            visit_time: hora,
          });
          await sendWhatsAppTemplate(telefono, "recordatorio_visita", [
            {
              type: "body",
              parameters: [
                { type: "text", parameter_name: "customer_name", text: nombre },
                { type: "text", parameter_name: "visit_date", text: fecha },
                { type: "text", parameter_name: "visit_time", text: hora },
              ],
            },
          ]);
        } catch (err) {
          console.warn(`⚠️ Template falló para ${telefono}:`, err.response?.data || err.message);
          await sendWhatsAppMessage(telefono, mensajeLibre);
        }

        await evento.update({ esperandoConfirmacion: true });

        try {
          let conv = await Conversacion.findOne({
            where: { telefono },
            order: [["ultimaActividad", "DESC"]],
          });

          if (!conv) {
            conv = await Conversacion.create({
              telefono,
              canal: "WhatsApp",
              waContactId: telefono,
              estado: "asesor",
              contactoNombre: evento.clienteNombre || null,
              contactoApellido: evento.clienteApellido || null,
              ultimoMensaje: "",
              ultimaActividad: new Date(),
            });
          } else {
            if (!conv.contactoNombre && evento.clienteNombre) {
              await conv.update({
                contactoNombre: evento.clienteNombre,
                contactoApellido: evento.clienteApellido || null,
              });
            }
          }

          // Este cron es, en varios casos, la primera vez que se toca esta
          // conversación desde este evento — si el evento todavía no estaba
          // vinculado (ej: visita cargada a mano sin engancharla al chat del
          // cliente), lo dejamos linkeado para que "ver chat" funcione.
          if (!evento.conversacionId) {
            await evento.update({ conversacionId: conv.id });
          }

          const textoRecordatorio = `[Recordatorio automático]\n${mensajeLibre}`;
          const mensajeGuardado = await Mensaje.create({
            conversacionId: conv.id,
            tipo: "saliente",
            autor: "bot",
            texto: textoRecordatorio,
            timestamp: new Date(),
          });

          await conv.update({
            ultimoMensaje: textoRecordatorio,
            ultimaActividad: new Date(),
          });

          try {
            getIO().emit("conversacion:mensaje", {
              conversacionId: conv.id,
              mensaje: {
                id: mensajeGuardado.id,
                tipo: "saliente",
                autor: "bot",
                texto: textoRecordatorio,
                timestamp: mensajeGuardado.timestamp,
              },
              ultimoMensaje: textoRecordatorio,
              ultimaActividad: new Date(),
            });
          } catch (_) {}
        } catch (e) {
          console.warn(`⚠️ No se pudo guardar mensaje de recordatorio en conv:`, e.message);
        }

        await logCron("recordatorio_visita", "ok", `Recordatorio enviado a ${telefono}`);
      } catch (err) {
        console.error(`❌ Error enviando a ${telefono}:`, err.message);
        await logCron("recordatorio_visita", "error", `Error enviando a ${telefono}`, err.message);
      }
    }

    const adminTelefono = process.env.ADMIN_WHATSAPP;

    if (adminTelefono && eventos.length > 0) {
      const resumen = eventos
        .map(e => {
          const estado = e.estado === "confirmada" ? "✅" : "⏳";
          const cliente =
            `${e.clienteNombre || ""} ${e.clienteApellido || ""}`.trim() || "Sin nombre";
          const vehiculo = e.vehiculo ? ` — ${e.vehiculo}` : "";
          const notas = e.notas ? `\n   📝 ${e.notas}` : "";
          return `${estado} ${e.horaInicio} hs — ${cliente}${vehiculo}${notas}`;
        })
        .join(" | ");

      try {
        await sendWhatsAppTemplate(adminTelefono, "resumen_dia_admin", [
          {
            type: "body",
            parameters: [
              { type: "text", parameter_name: "event_count", text: String(eventos.length) },
              { type: "text", parameter_name: "event_summary", text: resumen },
            ],
          },
        ]);
      } catch (err) {
        console.warn("⚠️ Template admin falló, usando mensaje libre...");
        try {
          await sendWhatsAppMessage(
            adminTelefono,
            `Car Place CRM — Agenda del día\n\nTenés ${eventos.length} evento(s) programado(s) para hoy:\n\n${resumen}\n\n¡Buen día!`,
          );
        } catch (err2) {
          console.error("❌ Error enviando resumen al admin:", err2.message);
        }
      }
    }
  } catch (err) {
    console.error("❌ Error en recordatorioVisitas:", err.message);
  }
};

const iniciarCron = async () => {
  cron.schedule("0 8 * * *", enviarRecordatorios, {
    timezone: "America/Argentina/Cordoba",
  });

  const hoy = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Cordoba",
  });

  const ahoraCordoba = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Cordoba" }),
  );

  if (ahoraCordoba.getHours() >= 8 && !corrioHoy) {
    const yaCorrio = await CronLog.findOne({
      where: {
        tipo: "recordatorio_visita",
        estado: "ok",
        createdAt: { [Op.gte]: new Date(`${hoy}T00:00:00-03:00`) },
      },
    });

    if (!yaCorrio) {
      corrioHoy = true;
      console.log("🔁 Recordatorio de hoy no ejecutado, lanzando ahora...");
      await enviarRecordatorios();
    } else {
      console.log("✅ Recordatorio de hoy ya ejecutado anteriormente.");
    }
  }

  console.log("⏰ Cron de recordatorios de visitas activo");
};

module.exports = { iniciarCron, enviarRecordatorios };
