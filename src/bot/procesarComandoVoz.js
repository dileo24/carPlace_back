// bot/tools/procesarComandoVoz.js
//
// Procesa audios y confirmaciones del admin desde WhatsApp.
//
// Flujo con preview:
//   1. Admin manda audio → transcribe → GPT interpreta → guarda en pendingMap → manda preview
//   2. Admin responde:
//      - "sí" / "dale" / "confirmar"  → ejecuta → manda resumen
//      - "no" / "cancelar"            → limpia → manda "Cancelado"
//      - otro audio                   → reinterpreta como corrección → nueva preview
//      - texto con corrección         → reinterpreta combinando intención anterior + corrección
const axios = require("axios");
const FormData = require("form-data");
const OpenAI = require("openai");
const { Op } = require("sequelize");
const { EventoCalendario, Tarea, Consulta, ConsultaHistorial, Conversacion } = require("../db");
const { programarSeguimiento } = require("../cronjobs/seguimientoPresencial");
const { sendWhatsAppMessage } = require("../services/whatsapp");
const { obtenerTodosLosUsuarioIds } = require("../services/eventoHelper");
const normalizarTelefono = require("../services/normalizarTelefono");
const { quitarMarca } = require("../services/quitarMarcaVehiculo");
const { buscarConsultaActiva, variantesTelefono } = require("../services/consultasHelper");

const { obtenerVocabularioAutos } = require("../services/vocabularioStock");
const { aplicarCorreccionesConocidas } = require("../services/correccionesFoneticas");

// Número del admin con prefijo completo internacional (sin +)
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP;
const ADMIN_USER_ID = 1;

// ─── Estado pendiente en memoria ─────────────────────────────────────────────
// Clave: número del admin. Valor: { intencion, preview, timestamp }
// Se limpia automáticamente si pasan más de 10 minutos sin confirmar
const pendingMap = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutos

function setPending(from, intencion, preview) {
  pendingMap.set(from, { intencion, preview, timestamp: Date.now() });
}

function getPending(from) {
  const entry = pendingMap.get(from);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > PENDING_TTL_MS) {
    pendingMap.delete(from);
    return null;
  }
  return entry;
}

function clearPending(from) {
  pendingMap.delete(from);
}

// ─── ¿Es audio del admin? ────────────────────────────────────────────────────
function esAudioDeAdmin(from, tipo) {
  if (!ADMIN_WHATSAPP) return false;
  const fromLimpio = from.replace(/\D/g, "");
  const adminLimpio = ADMIN_WHATSAPP.replace(/\D/g, "");
  return (
    (tipo === "audio" || tipo === "voice") &&
    (fromLimpio === adminLimpio ||
      fromLimpio === `549${adminLimpio}` ||
      `549${fromLimpio}` === adminLimpio)
  );
}

// ─── ¿Es texto del admin? ────────────────────────────────────────────────────
function esMensajeDeAdmin(from, tipo) {
  if (!ADMIN_WHATSAPP) return false;
  const fromLimpio = from.replace(/\D/g, "");
  const adminLimpio = ADMIN_WHATSAPP.replace(/\D/g, "");
  return (
    tipo === "text" &&
    (fromLimpio === adminLimpio ||
      fromLimpio === `549${adminLimpio}` ||
      `549${fromLimpio}` === adminLimpio)
  );
}

// ─── Descargar audio desde URL del webhook ───────────────────────────────────
// Con validación de integridad + reintentos: antes, si Meta cortaba la
// conexión a mitad de la descarga, el buffer truncado se usaba igual sin
// ningún error (mismo problema que se encontró y arregló en mediaWhatsApp.js).
async function descargarAudioWhatsApp(msg, { intentos = 3 } = {}) {
  const urlDirecta = msg.audio?.url || msg.voice?.url;
  const mimeTypeOriginal = msg.audio?.mime_type || msg.voice?.mime_type || "audio/ogg";

  console.log(`🔗 URL a descargar: ${urlDirecta?.slice(0, 80)}`);

  if (!urlDirecta) {
    throw new Error("No se encontró URL de audio en el mensaje del webhook");
  }

  let ultimoError = null;

  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const { data: audioBuffer, headers } = await axios.get(urlDirecta, {
        headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}` },
        responseType: "arraybuffer",
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024,
      });

      const buffer = Buffer.from(audioBuffer);
      const mimeType = headers["content-type"] || mimeTypeOriginal;
      const contentLengthHeader = headers["content-length"];

      if (contentLengthHeader) {
        const esperado = parseInt(contentLengthHeader, 10);
        if (!Number.isNaN(esperado) && buffer.length !== esperado) {
          throw new Error(
            `Descarga truncada: esperado ${esperado} bytes, recibido ${buffer.length} bytes`,
          );
        }
      } else {
        console.warn(
          `⚠️ Audio admin sin header content-length, no se puede validar integridad (recibido ${buffer.length} bytes)`,
        );
      }

      if (buffer.length === 0) {
        throw new Error("Descarga vacía (0 bytes)");
      }

      if (intento > 1) {
        console.log(`✅ Descarga de audio admin OK en intento ${intento}/${intentos}`);
      }

      return { buffer, mimeType };
    } catch (err) {
      ultimoError = err;
      console.warn(
        `⚠️ Falló descarga de audio admin (intento ${intento}/${intentos}): ${err.message}`,
      );
      if (intento < intentos) {
        await new Promise(r => setTimeout(r, 1000 * intento));
      }
    }
  }

  throw new Error(
    `No se pudo descargar el audio del admin tras ${intentos} intentos: ${ultimoError?.message}`,
  );
}

// ─── Transcribir con Whisper ─────────────────────────────────────────────────
async function transcribirConWhisper(buffer, mimeType, promptVocabulario = "") {
  const ext = mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("mp4")
      ? "mp4"
      : mimeType.includes("webm")
        ? "webm"
        : mimeType.includes("mpeg") || mimeType.includes("mp3")
          ? "mp3"
          : "ogg";

  const form = new FormData();
  form.append("file", buffer, {
    filename: `admin_audio.${ext}`,
    contentType: mimeType,
  });
  form.append("model", "whisper-1");
  form.append("language", "es");
  if (promptVocabulario) form.append("prompt", promptVocabulario);

  const { data } = await axios.post("https://api.openai.com/v1/audio/transcriptions", form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
  });

  return data.text?.trim() || "";
}

// ─── Interpretar intención con GPT ───────────────────────────────────────────
// Si se pasa `intencionPrevia`, GPT la usa como base para aplicar correcciones
async function interpretarIntencion(transcripcion, intencionPrevia = null, listaModelos = []) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const hoy = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Cordoba",
    dateStyle: "full",
    timeStyle: "short",
  });

  const contextoCorrecion = intencionPrevia
    ? `\nTenés una intención previa que el admin quiere corregir:\n${JSON.stringify(intencionPrevia, null, 2)}\nAplicá la corrección que indica la nueva transcripción sobre esa intención y devolvé el JSON actualizado.\n`
    : "";

  const contextoStock = listaModelos.length
    ? `\nMODELOS EN STOCK (para referencia): ${listaModelos.join(", ")}.\nLa transcripción viene de un audio y puede tener errores fonéticos. Si el texto menciona algo que suena parecido a uno de estos modelos (por ejemplo "foto 4K" en vez de "Ford Ka"), asumí que el admin dijo el modelo real de la lista y usalo correctamente en tu respuesta, en vez de tomar la transcripción literal.\n`
    : "";

  const systemPrompt = `Sos el asistente interno del CRM de SportQuatro, concesionaria de autos en Córdoba Argentina.
Hoy es: ${hoy}
${contextoCorrecion}${contextoStock}
Analizá la transcripción de voz del admin y devolvé UN objeto JSON con la acción a ejecutar.
Solo podés usar estas 3 acciones.

ACCIONES:

1. crear_evento — para visitas, citas, test drives, reuniones con clientes
{
  "accion": "crear_evento",
  "datos": {
    "titulo": "string descriptivo",
    "fecha": "YYYY-MM-DD",
    "horaInicio": "HH:MM",
    "clienteNombre": "string o null",
    "clienteApellido": "string o null",
    "clienteTelefono": "string o null",
    "vehiculo": "string o null",
    "notas": "string o null"
  }
}

2. crear_tarea — para pendientes, recordatorios, tareas internas
{
  "accion": "crear_tarea",
  "datos": {
    "titulo": "string",
    "tipo": "papeles | administrativo | alistaje | fotos_publicar | contactar | seguimiento",
    "descripcion": "string o null",
    "prioridad": "alta | media | baja"
  }
}

TIPO de tarea — elegí el más apropiado según el audio:
- "contactar"      → llamar, contactar, hablar con alguien
- "seguimiento"    → hacer seguimiento, recordar
- "administrativo" → trámites, pagos, gestiones internas
- "papeles"        → documentación, papeles, transferencia
- "alistaje"       → preparar auto, limpiar, revisar mecánica
- "fotos_publicar" → sacar fotos, publicar auto

3. crear_consulta — para clientes potenciales, interesados, contactos nuevos
{
  "accion": "crear_consulta",
  "datos": {
    "nombre": "string",
    "apellido": "string o null",
    "telefono": "string o null",
    "vehiculo": "string del auto de interés o null",
    "presupuesto": "número entero en ARS o null",
    "formaPago": "contado | financiado | usado | a_definir",
    "notas": "string o null"
  }
}

Si no podés determinar la intención devolvé:
{ "accion": "desconocido", "transcripcion": "texto original" }

REGLAS:
- Respondé SOLO con el JSON. Cero texto fuera del JSON, cero backticks, cero markdown.
- Inferí fechas relativas usando la fecha de hoy (ej: "mañana a las 10" → calculá la fecha exacta).
- Si dicen "a las 10" sin AM/PM, asumí AM para horario de concesionaria (8-20hs).
- El campo "titulo" NUNCA puede ser null. Siempre construilo así:
  "Visita — [clienteNombre] [clienteApellido]" si hay nombre.
  Si hay vehículo: "Visita — [vehiculo] — [clienteNombre]".
  Si no hay nombre ni vehículo: "Visita agendada".`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: transcripcion },
    ],
    temperature: 0.1,
    max_tokens: 400,
  });

  const raw = completion.choices[0].message.content?.trim() || "";

  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    console.error("❌ GPT devolvió JSON inválido:", raw.slice(0, 200));
    return { accion: "desconocido", transcripcion };
  }
}

// ─── Armar mensaje de preview ─────────────────────────────────────────────────
function armarPreview(intencion) {
  const { accion, datos } = intencion;

  if (accion === "crear_evento") {
    const fechaStr = datos.fecha
      ? new Date(`${datos.fecha}T00:00:00`).toLocaleDateString("es-AR", {
          weekday: "long",
          day: "2-digit",
          month: "2-digit",
        })
      : "Fecha no definida";
    const cliente = [datos.clienteNombre, datos.clienteApellido].filter(Boolean).join(" ");
    return (
      `📋 *Revisá antes de confirmar:*\n\n` +
      `📅 *Evento*\n` +
      `🏷️ ${datos.titulo || "Sin título"}\n` +
      `🗓️ ${fechaStr} a las ${datos.horaInicio || "??"} hs\n` +
      (cliente ? `👤 ${cliente}\n` : "") +
      (datos.vehiculo ? `🚗 ${datos.vehiculo}\n` : "") +
      (datos.notas ? `📝 ${datos.notas}\n` : "") +
      `\n✅ Respondé *"sí"* para crear, *"no"* para cancelar, o mandá otro audio para corregir.`
    );
  }

  if (accion === "crear_tarea") {
    const tipoLabel =
      {
        papeles: "Papeles",
        administrativo: "Administrativo",
        alistaje: "Alistaje",
        fotos_publicar: "Fotos / Publicar",
        contactar: "Contactar",
        seguimiento: "Seguimiento",
      }[datos.tipo] || datos.tipo;
    return (
      `📋 *Revisá antes de confirmar:*\n\n` +
      `📝 *Tarea*\n` +
      `🏷️ ${datos.titulo}\n` +
      `🗂️ Tipo: ${tipoLabel}\n` +
      `⚡ Prioridad: ${datos.prioridad || "media"}\n` +
      (datos.descripcion ? `📄 ${datos.descripcion}\n` : "") +
      `\n✅ Respondé *"sí"* para crear, *"no"* para cancelar, o mandá otro audio para corregir.`
    );
  }

  if (accion === "crear_consulta") {
    return (
      `📋 *Revisá antes de confirmar:*\n\n` +
      `🚗 *Consulta*\n` +
      `👤 ${datos.nombre}${datos.apellido ? ` ${datos.apellido}` : ""}\n` +
      (datos.telefono ? `📞 ${datos.telefono}\n` : "") +
      (datos.vehiculo ? `🚙 ${datos.vehiculo}\n` : "") +
      (datos.presupuesto ? `💰 Presupuesto: $${datos.presupuesto.toLocaleString("es-AR")}\n` : "") +
      (datos.formaPago && datos.formaPago !== "a_definir"
        ? `💳 Forma de pago: ${datos.formaPago}\n`
        : "") +
      (datos.notas ? `📝 ${datos.notas}\n` : "") +
      `\n✅ Respondé *"sí"* para crear, *"no"* para cancelar, o mandá otro audio para corregir.`
    );
  }

  return (
    `❓ No entendí bien el comando.\n\n` +
    `Podés pedirme:\n` +
    `• *Evento*: "Agendar visita con Juan Pérez mañana a las 10 para ver la Hilux"\n` +
    `• *Tarea*: "Recordame llamar a María el viernes, prioridad alta"\n` +
    `• *Consulta*: "Registrar cliente Pedro González interesado en una camioneta"`
  );
}

// ─── Ejecutar acción confirmada ───────────────────────────────────────────────
async function ejecutarAccion(intencion) {
  const { accion, datos } = intencion;

  // ── Evento ────────────────────────────────────────────────────────────────
  if (accion === "crear_evento") {
    // No confiamos en el "titulo" que devuelve la IA: aunque el prompt le pide
    // el orden vehículo → nombre, en la práctica no siempre lo respeta (o lo
    // arma sin el vehículo aun teniéndolo en "datos"). Si hay nombre o
    // vehículo, lo reconstruimos siempre acá de forma determinística.
    const clienteCompleto = datos.clienteNombre
      ? `${datos.clienteNombre}${datos.clienteApellido ? ` ${datos.clienteApellido}` : ""}`
      : "";
    // Mismo criterio que procesarMensaje.js: el título muestra solo el
    // modelo, sin la marca (quitarMarca), para que un evento agendado por
    // voz quede con el mismo formato que uno agendado por chat.
    const modeloSinMarca = datos.vehiculo ? await quitarMarca(datos.vehiculo) : null;
    const titulo =
      modeloSinMarca || clienteCompleto
        ? `Visita${modeloSinMarca ? ` — ${modeloSinMarca}` : ""}${clienteCompleto ? ` — ${clienteCompleto}` : ""}`
        : datos.titulo || "Visita agendada";

    // El banner de "visita pendiente" en el CRM se arma vía Consulta.eventos
    // (join por consultaId), nunca comparando clienteTelefono directamente —
    // sin esto el evento queda huérfano y no aparece en el chat aunque el
    // teléfono esté bien guardado. Mismo criterio que agendarVisita en
    // procesarMensaje.js.
    const telefonoEvento = datos.clienteTelefono ? normalizarTelefono(datos.clienteTelefono) : null;
    let consultaIdVinculada = null;
    let conversacionIdVinculada = null;

    if (telefonoEvento) {
      const conversacionExistente = await Conversacion.findOne({
        where: { telefono: { [Op.in]: variantesTelefono(telefonoEvento) } },
      });

      if (conversacionExistente) {
        conversacionIdVinculada = conversacionExistente.id;
        consultaIdVinculada = conversacionExistente.consultaId || null;
      }

      if (!consultaIdVinculada) {
        const consultaActiva = await buscarConsultaActiva(telefonoEvento);
        if (consultaActiva) {
          consultaIdVinculada = consultaActiva.id;
        } else if (datos.clienteNombre) {
          const nuevaConsulta = await Consulta.create({
            nombre: datos.clienteNombre,
            apellido: datos.clienteApellido || null,
            telefono: telefonoEvento,
            vehiculo: datos.vehiculo || null,
            formaPago: ["a_definir"],
            presupuesto: 0,
            origen: "WhatsApp",
            estado: "nuevo",
            cargadoPor: "admin",
            asesorId: null,
            notas: datos.notas || null,
          });
          consultaIdVinculada = nuevaConsulta.id;
        }

        if (conversacionExistente && consultaIdVinculada && !conversacionExistente.consultaId) {
          await conversacionExistente.update({ consultaId: consultaIdVinculada });
        }
      }
    }

    const evento = await EventoCalendario.create({
      titulo,
      tipo: "visita",
      fecha: datos.fecha,
      horaInicio: datos.horaInicio,
      estado: "pendiente",
      clienteNombre: datos.clienteNombre || null,
      clienteApellido: datos.clienteApellido || null,
      clienteTelefono: telefonoEvento,
      vehiculo: datos.vehiculo || null,
      notas: datos.notas || null,
      usuarioId: ADMIN_USER_ID,
      creadoPorId: ADMIN_USER_ID,
      creadoPorRol: "admin",
      consultaId: consultaIdVinculada,
      conversacionId: conversacionIdVinculada,
      invitadosIds: await obtenerTodosLosUsuarioIds(),
    });

    const fechaStr = new Date(`${datos.fecha}T00:00:00`).toLocaleDateString("es-AR", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
    });

    return (
      `✅ *Evento creado* 📅\n` +
      `🏷️ ${titulo}\n` +
      `🗓️ ${fechaStr} a las ${datos.horaInicio} hs\n` +
      (datos.clienteNombre ? `👤 ${datos.clienteNombre} ${datos.clienteApellido || ""}\n` : "") +
      (datos.vehiculo ? `🚗 ${datos.vehiculo}\n` : "") +
      (datos.notas ? `📝 ${datos.notas}\n` : "")
    );
  }

  // ── Tarea ─────────────────────────────────────────────────────────────────
  if (accion === "crear_tarea") {
    const tiposValidos = [
      "papeles",
      "administrativo",
      "alistaje",
      "fotos_publicar",
      "contactar",
      "seguimiento",
    ];
    const tipo = tiposValidos.includes(datos.tipo) ? datos.tipo : "administrativo";

    const tarea = await Tarea.create({
      titulo: datos.titulo,
      tipo,
      descripcion: datos.descripcion || null,
      prioridad: datos.prioridad || "media",
      creadoPor: "usuario",
      creadoPorId: ADMIN_USER_ID,
      estado: "pendiente",
      notas: [],
    });

    const tipoLabel =
      {
        papeles: "Papeles",
        administrativo: "Administrativo",
        alistaje: "Alistaje",
        fotos_publicar: "Fotos / Publicar",
        contactar: "Contactar",
        seguimiento: "Seguimiento",
      }[tipo] || tipo;

    return (
      `✅ *Tarea creada* 📋\n` +
      `🏷️ ${tarea.titulo}\n` +
      `🗂️ Tipo: ${tipoLabel}\n` +
      `⚡ Prioridad: ${tarea.prioridad}\n` +
      (tarea.descripcion ? `📝 ${tarea.descripcion}\n` : "") +
      `\n_Tarea ID #${tarea.id}_`
    );
  }

  // ── Consulta ──────────────────────────────────────────────────────────────
  if (accion === "crear_consulta") {
    const splitNombreApellido = require("../services/splitNombreApellido");
    const { nombre: nombreLimpio, apellido: apellidoLimpio } = splitNombreApellido(
      datos.nombre,
      datos.apellido,
    );
    const rawFormaPago = datos.formaPago || "a_definir";
    const formaPago = Array.isArray(rawFormaPago)
      ? rawFormaPago
      : rawFormaPago
          .split(",")
          .map(s => s.trim())
          .filter(Boolean);

    const consulta = await Consulta.create({
      nombre: nombreLimpio,
      apellido: apellidoLimpio,
      telefono: datos.telefono ? normalizarTelefono(datos.telefono) : null,
      vehiculo: datos.vehiculo || null,
      presupuesto: datos.presupuesto || 0,
      formaPago,
      notas: datos.notas || null,
      estado: "nuevo",
      origen: "WhatsApp",
      cargadoPor: "admin",
      asesorId: ADMIN_USER_ID,
      estadoCambiadoEn: new Date(),
    });

    await ConsultaHistorial.create({
      tipo: "sistema",
      texto: `Consulta creada por voz del admin con estado "Nuevo".`,
      consultaId: consulta.id,
    });

    try {
      programarSeguimiento(consulta.toJSON());
    } catch (_) {}

    return (
      `✅ *Consulta creada* 🚗\n` +
      `👤 ${consulta.nombre}${consulta.apellido ? ` ${consulta.apellido}` : ""}\n` +
      (consulta.telefono ? `📞 ${consulta.telefono}\n` : "") +
      (consulta.vehiculo ? `🚙 ${consulta.vehiculo}\n` : "") +
      (consulta.notas ? `📝 ${consulta.notas}\n` : "") +
      `\n_Consulta ID #${consulta.id}_`
    );
  }

  return (
    `❓ No entendí bien el comando.\n\n` +
    `Podés pedirme:\n` +
    `• *Evento*: "Agendar visita con Juan Pérez mañana a las 10 para ver la Hilux"\n` +
    `• *Tarea*: "Recordame llamar a María el viernes, prioridad alta"\n` +
    `• *Consulta*: "Registrar cliente Pedro González interesado en una camioneta"`
  );
}

// ─── Función principal: audio nuevo del admin ────────────────────────────────
async function procesarAudioAdmin(msg, from) {
  const mediaId = msg.audio?.id || msg.voice?.id;
  console.log(`🎙️ Audio del admin — mediaId: ${mediaId}`);

  try {
    // NUEVO: traer vocabulario de stock una sola vez, se reusa para Whisper e interpretación
    const { promptWhisper, listaPlano } = await obtenerVocabularioAutos();

    // 1. Descargar y transcribir
    const { buffer, mimeType } = await descargarAudioWhatsApp(msg);
    console.log(`📥 Audio descargado. mimeType: ${mimeType}, bytes: ${buffer.length}`);

    let transcripcion = await transcribirConWhisper(buffer, mimeType, promptWhisper); // NUEVO: pasa promptWhisper
    transcripcion = aplicarCorreccionesConocidas(transcripcion); // NUEVO: red de seguridad por regex
    console.log(`📝 Transcripción admin: "${transcripcion}"`);

    if (!transcripcion || transcripcion.length < 3) {
      await sendWhatsAppMessage(
        from,
        "⚠️ No pude escuchar bien el audio. ¿Podés intentar de nuevo?",
      );
      return;
    }

    // 2. Si hay intención pendiente, verificar si es confirmación/cancelación/corrección
    const pending = getPending(from);
    if (pending) {
      const textoNorm = transcripcion.toLowerCase().trim();
      const CONFIRMACIONES = [
        "sí",
        "si",
        "dale",
        "confirmar",
        "ok",
        "okey",
        "va",
        "bueno",
        "sí dale",
        "si dale",
      ];
      const CANCELACIONES = ["no", "cancelar", "olvidá", "olvidalo", "no gracias"];

      if (
        CONFIRMACIONES.some(
          c => textoNorm === c || textoNorm.startsWith(c + " ") || textoNorm.includes(c),
        )
      ) {
        console.log(`✅ Admin confirmó por audio: ${pending.intencion.accion}`);
        clearPending(from);
        const resumen = await ejecutarAccion(pending.intencion);
        await sendWhatsAppMessage(from, resumen);
        return;
      }

      if (CANCELACIONES.some(c => textoNorm === c || textoNorm.startsWith(c + " "))) {
        console.log(`❌ Admin canceló por audio`);
        clearPending(from);
        await sendWhatsAppMessage(from, "❌ Cancelado. Cuando quieras mandá otro audio.");
        return;
      }
      // Si no es confirmación ni cancelación → sigue como corrección
    }

    // 3. Interpretar (con intención previa como contexto si hay corrección)
    const intencionPrevia = pending ? pending.intencion : null;
    if (intencionPrevia) {
      console.log(`🔄 Corrección por audio sobre intención previa: ${intencionPrevia.accion}`);
    }

    const intencion = await interpretarIntencion(transcripcion, intencionPrevia, listaPlano); // NUEVO: pasa listaPlano
    console.log(`🧠 Intención detectada: ${intencion.accion}`);

    if (intencion.accion === "desconocido") {
      clearPending(from);
      await sendWhatsAppMessage(from, armarPreview(intencion));
      return;
    }

    // 4. Las tareas se crean directo, sin pedir confirmación — a diferencia
    // de eventos y consultas, el admin pidió explícitamente que no haya paso
    // de "revisá antes de confirmar" para tareas.
    if (intencion.accion === "crear_tarea") {
      clearPending(from);
      try {
        const resumen = await ejecutarAccion(intencion);
        await sendWhatsAppMessage(from, resumen);
      } catch (err) {
        console.error("❌ ejecutarAccion (tarea directa) error:", err.message);
        await sendWhatsAppMessage(from, `❌ Error al crear la tarea: ${err.message}`);
      }
      return;
    }

    // 5. Guardar pendiente y mandar preview (eventos y consultas)
    const preview = armarPreview(intencion);
    setPending(from, intencion, preview);
    await sendWhatsAppMessage(from, preview);
  } catch (err) {
    console.error("❌ procesarAudioAdmin error:", err.message);
    try {
      await sendWhatsAppMessage(
        from,
        `❌ Error procesando el audio: ${err.message}\n\nIntentaló de nuevo.`,
      );
    } catch (_) {}
  }
}

// ─── Función secundaria: texto del admin (confirmación o corrección) ──────────
async function procesarRespuestaAdmin(texto, msg, from) {
  const pending = getPending(from);

  // Si no hay nada pendiente, ignorar silenciosamente
  if (!pending) {
    console.log(`💬 Texto del admin sin pendiente — ignorado: "${texto.slice(0, 50)}"`);
    return;
  }

  const textoNorm = texto.toLowerCase().trim();

  // ── Confirmación ──────────────────────────────────────────────────────────
  const CONFIRMACIONES = [
    "sí",
    "si",
    "dale",
    "confirmar",
    "confirmado",
    "ok",
    "okey",
    "va",
    "crear",
    "sí dale",
    "si dale",
    "bueno",
  ];
  if (CONFIRMACIONES.some(c => textoNorm === c || textoNorm.startsWith(c + " "))) {
    console.log(`✅ Admin confirmó la acción: ${pending.intencion.accion}`);
    clearPending(from);
    try {
      const resumen = await ejecutarAccion(pending.intencion);
      await sendWhatsAppMessage(from, resumen);
    } catch (err) {
      console.error("❌ ejecutarAccion error:", err.message);
      await sendWhatsAppMessage(from, `❌ Error al crear: ${err.message}`);
    }
    return;
  }

  // ── Cancelación ───────────────────────────────────────────────────────────
  const CANCELACIONES = ["no", "cancelar", "cancelado", "no gracias", "olvidá", "olvidalo"];
  if (CANCELACIONES.some(c => textoNorm === c || textoNorm.startsWith(c + " "))) {
    console.log(`❌ Admin canceló la acción`);
    clearPending(from);
    await sendWhatsAppMessage(from, "❌ Cancelado. Cuando quieras mandá otro audio.");
    return;
  }

  // ── Corrección por texto ──────────────────────────────────────────────────
  // El admin mandó un texto que no es ni confirmación ni cancelación
  // → reinterpretar como corrección sobre la intención pendiente
  console.log(`✏️ Corrección por texto: "${texto.slice(0, 80)}"`);
  try {
    const { listaPlano } = await obtenerVocabularioAutos(); // NUEVO
    const intencionCorregida = await interpretarIntencion(texto, pending.intencion, listaPlano); // NUEVO: pasa listaPlano
    if (intencionCorregida.accion === "desconocido") {
      await sendWhatsAppMessage(
        from,
        `No entendí la corrección. La intención anterior sigue pendiente.\n\n${pending.preview}`,
      );
      return;
    }

    // Igual que en el primer audio: una tarea (incluso corregida) se crea
    // directo, sin volver a pedir confirmación.
    if (intencionCorregida.accion === "crear_tarea") {
      clearPending(from);
      const resumen = await ejecutarAccion(intencionCorregida);
      await sendWhatsAppMessage(from, resumen);
      return;
    }

    const preview = armarPreview(intencionCorregida);
    setPending(from, intencionCorregida, preview);
    await sendWhatsAppMessage(from, preview);
  } catch (err) {
    console.error("❌ procesarRespuestaAdmin corrección error:", err.message);
    await sendWhatsAppMessage(from, `❌ Error procesando la corrección: ${err.message}`);
  }
}

module.exports = { procesarAudioAdmin, procesarRespuestaAdmin, esAudioDeAdmin, esMensajeDeAdmin };
