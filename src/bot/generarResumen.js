const OpenAI = require("openai");
const buildResumenPrompt = require("./buildResumenPrompt");
const { Conversacion, Consulta } = require("../db");
const { getIO } = require("./socket");

async function generarResumen(conversacionId) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const conversacion = await Conversacion.findByPk(conversacionId, {
    include: [{ association: "mensajes", order: [["timestamp", "ASC"]] }],
  });

  if (!conversacion) throw new Error("Conversación no encontrada");

  const mensajesCliente = (conversacion.mensajes || []).filter(m => m.autor === "contacto");

  let resumen = null;
  let vehiculoDetectado = null;
  let categoriaDetectada = null;

  if (mensajesCliente.length === 0 && conversacion.consultaId) {
    // Sin mensajes del cliente — construir resumen desde la consulta
    const consulta = await Consulta.findByPk(conversacion.consultaId);
    if (consulta) {
      const partes = [];

      if (consulta.vehiculo) partes.push(`Vehículo de interés: ${consulta.vehiculo}`);
      if (consulta.presupuesto) {
        const moneda = consulta.moneda || "ARS";
        partes.push(
          `Presupuesto: ${moneda} ${Number(consulta.presupuesto).toLocaleString("es-AR")}`,
        );
      }
      if (consulta.formaPago) {
        let fp = consulta.formaPago;
        if (typeof fp === "string") {
          try {
            fp = JSON.parse(fp);
          } catch {
            fp = [fp];
          }
        }
        if (Array.isArray(fp) && fp.length) partes.push(`Forma de pago: ${fp.join(", ")}`);
      }
      if (consulta.origen) partes.push(`Origen: ${consulta.origen}`);
      if (consulta.notas) partes.push(`Notas: ${consulta.notas}`);
      if (consulta.asesorNombre)
        partes.push(`Asesor: ${consulta.asesorNombre} ${consulta.asesorApellido || ""}`.trim());

      resumen = partes.length
        ? `Cliente sin respuesta aún. Datos de la consulta:\n${partes.join("\n")}`
        : "Cliente sin respuesta aún. Sin datos adicionales de la consulta.";

      // Esta consulta ya existe y ya tiene su propio campo `vehiculo` —
      // no hace falta inferir nada acá, así que no tocamos perfil.
    }
  } else {
    // Flujo normal — resumir el historial del chat y extraer datos estructurados
    const historial = (conversacion.mensajes || [])
      .map(m => `${m.autor === "contacto" ? "Cliente" : "Bot/Asesor"}: ${m.texto}`)
      .join("\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildResumenPrompt() },
        { role: "user", content: `Conversación:\n\n${historial}` },
      ],
    });

    const raw = response.choices[0].message.content?.trim();
    try {
      const parsed = JSON.parse(raw);
      resumen = parsed.resumen?.trim() || null;
      vehiculoDetectado = parsed.vehiculo?.trim() || null;
      categoriaDetectada = parsed.categoria?.trim() || null;
    } catch (e) {
      // Fallback defensivo: si por algún motivo no vino JSON válido,
      // al menos no perdemos el resumen — lo tratamos como texto plano.
      console.warn(
        "⚠️ generarResumen: la respuesta no fue JSON válido, usando texto crudo:",
        e.message,
      );
      resumen = raw || null;
    }
  }

  if (!resumen) return null;

  const updates = { resumenIA: resumen, resumenIAUpdatedAt: new Date() };

  // Completar perfil.vehiculo solo si todavía no estaba seteado —
  // no pisamos un dato que ya haya cargado crearConsulta/agendarVisita.
  if (vehiculoDetectado) {
    let perfilActual = conversacion.perfil || {};
    if (typeof perfilActual === "string") {
      try {
        perfilActual = JSON.parse(perfilActual);
      } catch {
        perfilActual = {};
      }
    }

    if (!perfilActual.vehiculo?.modelo) {
      updates.perfil = {
        ...perfilActual,
        vehiculo: {
          ...(perfilActual.vehiculo || {}),
          modelo: vehiculoDetectado,
          ...(categoriaDetectada && { categoria: categoriaDetectada }),
        },
      };
    }
  }

  await conversacion.update(updates);

  if (conversacion.consultaId) {
    const consulta = await Consulta.findByPk(conversacion.consultaId);
    if (consulta) {
      const consultaUpdates = { notas: resumen };
      // Si la consulta ya existe pero todavía no tiene vehículo cargado
      // (por ejemplo, se creó desde generarConsulta.js sin datos), lo completamos.
      if (vehiculoDetectado && !consulta.vehiculo) consultaUpdates.vehiculo = vehiculoDetectado;
      if (categoriaDetectada && !consulta.categoria) consultaUpdates.categoria = categoriaDetectada;
      await consulta.update(consultaUpdates);
    }
  }

  try {
    getIO().emit("conversacion:resumenActualizado", {
      conversacionId: conversacion.id,
      resumenIA: resumen,
    });
  } catch (_) {}

  return resumen;
}

module.exports = generarResumen;
