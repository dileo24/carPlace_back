const cron = require("node-cron");
const { Conversacion, Mensaje, EventoCalendario, Consulta, User } = require("../db");
const { Op } = require("sequelize");
const { sendWhatsAppMessage, sendWhatsAppTemplate } = require("../services/whatsapp");
const { getIO } = require("../bot/socket");
const { logCron } = require("../services/cronLog");
const { generarMensajeReactivacion, nombreValido } = require("../services/generarMensajeReactivacion");

const ROLES_VENDEDOR = ["vendedor", "publicador_vendedor"];
const MENSAJE_SEGUIMIENTO_7_DIAS =
  "¡Hola! Esperamos que se encuentre muy bien.\n\n" +
  "Queríamos saber si todavía sigue con interés por el vehículo que consultó. Además, queríamos saber si ya se encuentra en contacto con alguno de nuestros asesores desde otro número de WhatsApp, para evitar generar mensajes duplicados.\n\n" +
  "Quedamos atentos a su respuesta. Muchas gracias.";

function iniciarCronInactividad() {
  // Corre todos los días a las 10am — reactiva conversaciones inactivas hace más de 3 días
  cron.schedule(
    "0 10 * * *",
    async () => {
      console.log("🔍 Chequeando conversaciones inactivas...");
      try {
        const hace3Dias = new Date();
        hace3Dias.setDate(hace3Dias.getDate() - 3);

        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const en2Semanas = new Date(hoy);
        en2Semanas.setDate(en2Semanas.getDate() + 14);

        const conversaciones = await Conversacion.findAll({
          where: {
            estado: { [Op.in]: ["bot", "asesor"] },
            ultimaActividad: { [Op.lt]: hace3Dias },
            reactivacionEnviada: false,
            createdAt: { [Op.lt]: hace3Dias },
          },
          include: [
            {
              model: Consulta,
              as: "consulta",
              required: false,
              include: [
                {
                  model: EventoCalendario,
                  as: "eventos",
                  required: false,
                  where: {
                    fecha: {
                      [Op.gte]: hoy.toISOString().split("T")[0],
                      [Op.lte]: en2Semanas.toISOString().split("T")[0],
                    },
                    estado: { [Op.in]: ["pendiente", "confirmada"] },
                  },
                },
              ],
            },
          ],
        });
        // Filtrá en memoria las que tienen evento futuro o cuya consulta
        // vinculada ya está "cerrado" (venta concretada, no tiene sentido
        // reactivar). "perdido" sí se manda a propósito — igual que en el
        // seguimiento de 7 días, un perdido puede seguir en contacto por otro
        // medio y este mensaje ayuda a detectarlo.
        const conversacionesSinEvento = conversaciones.filter(conv => {
          const eventos = conv.consulta?.eventos ?? [];
          if (eventos.length > 0) return false;
          if (conv.consulta?.estado === "cerrado") return false;
          return true;
        });

        console.log(
          `📋 ${conversaciones.length} conversaciones inactivas, ${conversacionesSinEvento.length} para reactivar`,
        );

        for (const conv of conversacionesSinEvento) {
          try {
            const mensaje = await generarMensajeReactivacion(conv);
            if (!mensaje) continue;

            const nombreMostrar = nombreValido(conv.contactoNombre) || "cliente";

            try {
              await sendWhatsAppTemplate(conv.telefono, "reactivacion_cliente", [
                {
                  type: "body",
                  parameters: [
                    {
                      type: "text",
                      parameter_name: "customer_name",
                      text: nombreMostrar,
                    },
                  ],
                },
              ]);
            } catch (err) {
              console.warn(`⚠️ Template falló para conv ${conv.id}, usando mensaje libre...`);
              await sendWhatsAppMessage(conv.telefono, mensaje);
            }

            const mensajeGuardado = await Mensaje.create({
              conversacionId: conv.id,
              tipo: "saliente",
              autor: "bot",
              texto: mensaje,
              timestamp: new Date(),
            });

            await conv.update({
              ultimoMensaje: mensaje,
              ultimaActividad: new Date(),
              reactivacionEnviada: true, // ← marcar como reactivada
            });

            try {
              getIO().emit("conversacion:mensaje", {
                conversacionId: conv.id,
                mensaje: {
                  id: mensajeGuardado.id,
                  tipo: "saliente",
                  autor: "bot",
                  texto: mensaje,
                  timestamp: mensajeGuardado.timestamp,
                },
                ultimoMensaje: mensaje,
                ultimaActividad: new Date(),
              });
            } catch (_) {}

            console.log(`✅ Reactivación enviada a conv ${conv.id} (${conv.telefono})`);
            await logCron("reactivacion_cliente", "ok", `Reactivación enviada a conv ${conv.id}`);
          } catch (err) {
            console.error(`❌ Error reactivando conv ${conv.id}:`, err.message);
            await logCron(
              "reactivacion_cliente",
              "error",
              `Error reactivando conv ${conv.id}`,
              err.message,
            );
          }
        }
      } catch (err) {
        console.error("❌ Error en cron de inactividad:", err.message);
        await logCron(
          "reactivacion_cliente",
          "error",
          "Error general en cron de inactividad",
          err.message,
        );
      }
    },
    { timezone: "America/Argentina/Cordoba" },
  );
}

function iniciarCronSeguimiento7Dias() {
  // Corre todos los días a las 10:15am — a diferencia de la reactivación de 3
  // días (que aplica a cualquier conversación), este chequeo es solo para
  // conversaciones que un vendedor/publicador_vendedor tomó y le respondió al
  // cliente, y sigue sin actividad desde hace 7 días.
  cron.schedule(
    "15 10 * * *",
    async () => {
      console.log("🔍 Chequeando seguimiento de 7 días para conversaciones de vendedores...");
      try {
        const hace7Dias = new Date();
        hace7Dias.setDate(hace7Dias.getDate() - 7);

        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const en2Semanas = new Date(hoy);
        en2Semanas.setDate(en2Semanas.getDate() + 14);

        const conversaciones = await Conversacion.findAll({
          where: {
            estado: { [Op.ne]: "cerrada" },
            asesorId: { [Op.ne]: null },
            ultimaActividad: { [Op.lt]: hace7Dias },
            seguimiento7DiasEnviado: false,
          },
          include: [
            {
              model: User,
              as: "asesorAsignado",
              required: true,
              where: { rol: { [Op.in]: ROLES_VENDEDOR } },
              attributes: ["id", "rol"],
            },
            {
              model: Consulta,
              as: "consulta",
              required: false,
              include: [
                {
                  model: EventoCalendario,
                  as: "eventos",
                  required: false,
                  where: {
                    fecha: {
                      [Op.gte]: hoy.toISOString().split("T")[0],
                      [Op.lte]: en2Semanas.toISOString().split("T")[0],
                    },
                    estado: { [Op.in]: ["pendiente", "confirmada"] },
                  },
                },
              ],
            },
          ],
        });

        const conversacionesSinEvento = conversaciones.filter(conv => {
          const eventos = conv.consulta?.eventos ?? [];
          if (eventos.length > 0) return false;
          // Si la consulta ya se concretó (venta cerrada) no tiene sentido
          // preguntarle al cliente si "sigue interesado". "perdido" sí se
          // manda: puede haber pasado a perdida y el vendedor seguir
          // hablándole por otro medio, que es justo lo que este mensaje
          // ayuda a detectar.
          const estadoConsulta = conv.consulta?.estado;
          if (estadoConsulta === "cerrado") return false;
          return true;
        });

        console.log(
          `📋 ${conversaciones.length} conversaciones de vendedores inactivas hace 7+ días, ${conversacionesSinEvento.length} para seguimiento`,
        );

        for (const conv of conversacionesSinEvento) {
          try {
            try {
              await sendWhatsAppTemplate(conv.telefono, "seguimiento_7_dias", []);
            } catch (err) {
              console.warn(`⚠️ Template seguimiento_7_dias falló para conv ${conv.id}, usando mensaje libre...`);
              await sendWhatsAppMessage(conv.telefono, MENSAJE_SEGUIMIENTO_7_DIAS);
            }

            const mensajeGuardado = await Mensaje.create({
              conversacionId: conv.id,
              tipo: "saliente",
              autor: "bot",
              texto: MENSAJE_SEGUIMIENTO_7_DIAS,
              timestamp: new Date(),
              esSeguimiento7Dias: true,
            });

            await conv.update({
              ultimoMensaje: MENSAJE_SEGUIMIENTO_7_DIAS,
              ultimaActividad: new Date(),
              seguimiento7DiasEnviado: true,
              esperandoRespuestaSeguimiento7Dias: true,
            });

            try {
              getIO().emit("conversacion:mensaje", {
                conversacionId: conv.id,
                mensaje: {
                  id: mensajeGuardado.id,
                  tipo: "saliente",
                  autor: "bot",
                  texto: MENSAJE_SEGUIMIENTO_7_DIAS,
                  timestamp: mensajeGuardado.timestamp,
                  esSeguimiento7Dias: true,
                },
                // El frontend descarta este update entero si quien lo recibe es
                // vendedor (ver Conversaciones.jsx) — admin/supervisor sí lo procesan.
                ultimoMensaje: MENSAJE_SEGUIMIENTO_7_DIAS,
                ultimaActividad: new Date(),
              });
            } catch (_) {}

            console.log(`✅ Seguimiento de 7 días enviado a conv ${conv.id} (${conv.telefono})`);
            await logCron("seguimiento_7_dias", "ok", `Seguimiento de 7 días enviado a conv ${conv.id}`);
          } catch (err) {
            console.error(`❌ Error en seguimiento de 7 días conv ${conv.id}:`, err.message);
            await logCron(
              "seguimiento_7_dias",
              "error",
              `Error en seguimiento de 7 días conv ${conv.id}`,
              err.message,
            );
          }
        }
      } catch (err) {
        console.error("❌ Error en cron de seguimiento de 7 días:", err.message);
        await logCron(
          "seguimiento_7_dias",
          "error",
          "Error general en cron de seguimiento de 7 días",
          err.message,
        );
      }
    },
    { timezone: "America/Argentina/Cordoba" },
  );
}

module.exports = { iniciarCronInactividad, iniciarCronSeguimiento7Dias };
