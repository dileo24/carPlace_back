const OpenAI = require("openai");

const NOMBRES_INVALIDOS = ["cliente", "no disponible", "anónimo", "anonimo", "sin nombre", "desconocido"];

// Nombre de contacto usable para saludar, o null si es un placeholder tipo
// "cliente"/"anónimo" (en cuyo caso no se personaliza el saludo).
const nombreValido = nombreContacto => {
  if (!nombreContacto) return null;
  return NOMBRES_INVALIDOS.includes(nombreContacto.toLowerCase().trim()) ? null : nombreContacto;
};

// Genera (con IA) el mensaje de WhatsApp para reactivar una conversación
// inactiva, con fallback a un mensaje fijo si la IA falla o se excede.
async function generarMensajeReactivacion(conversacion) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const nombre = nombreValido(conversacion.contactoNombre);

  const saludo = nombre ? `Hola ${nombre}` : "Hola";
  const contexto = conversacion.resumenIA
    ? `Contexto de la consulta previa: ${conversacion.resumenIA}`
    : "El cliente tuvo una consulta previa pero no hay resumen disponible.";

  const prompt = `Sos el asistente de Car Place, una concesionaria de autos en Córdoba, Argentina.
Tenés que escribir un mensaje de WhatsApp para retomar contacto con un cliente inactivo.

${contexto}

REGLAS ESTRICTAS:
- Empezá con "${saludo},"
- Una sola oración preguntando si sigue interesado o si quedó alguna duda pendiente, adaptada al contexto de la consulta
- No firmes, no pongas "Car Place" al final, no pongas "saludos", no agregues nada más
- Usá "usted" siempre
- Sin markdown, solo texto plano
- Máximo 2 líneas en total

EJEMPLOS DE FORMATO CORRECTO:
"Hola Juan, queríamos saber si sigue interesado en el Fiat Fiorino que consultó o si le quedó alguna duda."
"Hola, queríamos saber si pudo avanzar con la decisión sobre el vehículo que consultó."

EJEMPLOS INCORRECTOS (no hacer):
"Hola Juan, espero que esté bien. Saludos, Car Place."
"Hola, desde Car Place le escribimos para..."
"Estimado cliente, nos comunicamos desde Car Place..."

Escribí solo el mensaje, sin comillas, sin explicaciones.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 100,
  });

  const mensaje = response.choices[0].message.content?.trim();

  if (!mensaje || mensaje.length > 200 || mensaje.toLowerCase().includes("car place")) {
    const fallback = nombre
      ? `Hola ${nombre}, queríamos saber si sigue interesado en el vehículo que consultó o si le quedó alguna duda pendiente.`
      : `Hola, queríamos saber si sigue interesado en el vehículo que consultó o si le quedó alguna duda pendiente.`;
    console.log(`⚠️ Mensaje de reactivación reemplazado por fallback para conv ${conversacion.id}`);
    return fallback;
  }

  return mensaje;
}

module.exports = { generarMensajeReactivacion, nombreValido };
