const { Consulta, Conversacion, Mensaje } = require("../db");
const { sendWhatsAppMessage, sendWhatsAppTemplate } = require("../services/whatsapp");
const { getIO } = require("../bot/socket");

const DELAY_MS = 5 * 60 * 1000; // 5 minutos

async function programarSeguimiento(consulta) {
  // Solo para presenciales con teléfono
  if (consulta.origen !== "Presencial") return;
  if (!consulta.telefono) return;
  // Normalizar teléfono
  let telefono = consulta.telefono.replace(/\D/g, "");

  if (telefono.startsWith("549")) {
    // ok
  } else if (telefono.startsWith("54")) {
    telefono = "549" + telefono.slice(2);
  } else if (telefono.length === 10) {
    telefono = "549" + telefono;
  } else if (telefono.length === 7 || telefono.length === 8) {
    console.warn(`⚠️ Teléfono demasiado corto para normalizar: ${telefono}, se omite`);
    return;
  } else {
    telefono = "549" + telefono;
  }
  setTimeout(async () => {
    try {
      // Re-fetch para verificar que la consulta siga activa
      const consultaActual = await Consulta.findByPk(consulta.id);
      if (!consultaActual) return;
      if (["cerrado", "perdido"].includes(consultaActual.estado)) return;

      const nombre = consultaActual.nombre || null;
      const saludo = nombre ? `Hola ${nombre}!` : "Hola!";
      const vehiculo = consultaActual.vehiculo ? `el ${consultaActual.vehiculo}` : "el vehículo";
      const mensaje = `${saludo} Nos comunicamos de SportQuatro Automotores. Queríamos saber qué le pareció ${vehiculo} que vio recién en nuestra sucursal y si tiene alguna duda o necesita más información para avanzar en su decisión. Estamos a su disposición, aguardamos su respuesta. Gracias`;

      try {
        await sendWhatsAppTemplate(telefono, "seguimiento_presencial", [
          {
            type: "body",
            parameters: [
              {
                type: "text",
                parameter_name: "customer_name",
                text: consultaActual.nombre || "cliente",
              },
              {
                type: "text",
                parameter_name: "vehiculo",
                text: vehiculo,
              },
            ],
          },
        ]);
      } catch (err) {
        console.warn(`⚠️ Template falló para ${telefono}, usando mensaje libre...`);
        await sendWhatsAppMessage(telefono, mensaje);
      }

      console.log(`✅ Seguimiento presencial enviado a ${telefono} (consulta ${consulta.id})`);

      // Crear o encontrar la conversación
      let conv = await Conversacion.findOne({ where: { telefono } });
      if (!conv) {
        conv = await Conversacion.create({
          telefono,
          waContactId: telefono,
          canal: "WhatsApp",
          estado: "asesor",
          contactoNombre: consulta.nombre || null,
          contactoApellido: consulta.apellido || null,
          consultaId: consulta.id,
          asesorId: consulta.asesorId || null,
          asesorNombre: consulta.asesorNombre || null,
          asesorApellido: consulta.asesorApellido || null,
          ultimaActividad: new Date(),
        });
        try {
          getIO().emit("conversacion:nueva", { conversacion: conv.toJSON() });
        } catch (_) {}
      } else {
        // Si ya existe, asignarla al asesor y marcarla como asesor
        await conv.update({
          estado: "asesor",
          asesorId: consulta.asesorId || null,
          asesorNombre: consulta.asesorNombre || null,
          asesorApellido: consulta.asesorApellido || null,
          consultaId: consulta.id,
          ultimaActividad: new Date(),
        });
        try {
          getIO().emit("conversacion:estadoCambiado", {
            conversacionId: conv.id,
            estado: "asesor",
            asesorNombre: consulta.asesorNombre,
            asesorApellido: consulta.asesorApellido,
          });
        } catch (_) {}
      }

      // Guardar el mensaje en el historial de la conversación
      const mensajeGuardado = await Mensaje.create({
        conversacionId: conv.id,
        tipo: "saliente",
        autor: "bot",
        texto: mensaje,
        timestamp: new Date(),
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
    } catch (err) {
      console.error(`❌ Error en seguimiento presencial consulta ${consulta.id}:`, err.message);
    }
  }, DELAY_MS);
}

module.exports = { programarSeguimiento };
