const tools = [
  {
    type: "function",
    function: {
      name: "buscarAuto",
      description:
        "OBLIGATORIO llamar antes de mencionar cualquier auto, en CADA pregunta nueva del cliente. Busca el stock real de Car Place. Cada consulta es independiente — una búsqueda anterior nunca reemplaza a una nueva.",
      parameters: {
        type: "object",
        properties: {
          busqueda: {
            type: "string",
            description:
              "Texto libre con marca, modelo, año o cualquier dato del auto. Ej: 'Volkswagen Golf 2020'",
          },
          precioMin: {
            type: "number",
            description:
              "Precio mínimo en ARS en valor completo (ej: 14000000, nunca 14). Solo usar si el cliente especificó un rango mínimo.",
          },
          precioMax: {
            type: "number",
            description:
              "Precio máximo en ARS en valor completo (ej: 20000000, nunca 20). Siempre pasarlo cuando el cliente mencionó un presupuesto. Pasá el valor exacto que mencionó el cliente — el sistema aplica automáticamente el rango correspondiente. IMPORTANTE: cuando el cliente ya estableció un presupuesto en un mensaje anterior, SIEMPRE reaplică este parámetro en búsquedas siguientes aunque no lo repita.",
          },
          kmMax: {
            type: "number",
            description:
              "Kilómetros máximos del vehículo en números enteros. Solo usar si el cliente especificó explícitamente un límite de kilómetros. IMPORTANTE: si el cliente ya estableció un kmMax en un mensaje anterior, SIEMPRE reaplică este parámetro en búsquedas siguientes aunque no lo repita. Ej: si dice 'menos de 100.000 km' → 100000",
          },
          combustible: {
            type: "string",
            description:
              "Filtrar por tipo de combustible. Valores posibles: 'Nafta', 'Nafta/GNC', 'Diésel'. Solo usar si el cliente lo especificó.",
          },
          color: {
            type: "string",
            description:
              "Filtrar por color del vehículo. Solo usar si el cliente lo especificó. Ej: 'rojo', 'blanco', 'negro'.",
          },
        },
        required: ["busqueda"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "evaluarAnioPartePago",
      description:
        "OBLIGATORIO llamar SIEMPRE que el cliente mencione marca y año de un vehículo PROPIO que quiere entregar como parte de pago, antes de decirle si se acepta o rechaza por año o kilometraje. NUNCA calcules vos si el año cumple el mínimo de la marca — esta función hace la cuenta exacta y te devuelve el veredicto ya evaluado (ACEPTADO/RECHAZADO) junto con la instrucción de qué responder. Repetí ese veredicto tal cual, nunca lo reinterpretes ni lo corrijas con tu propio criterio.",
      parameters: {
        type: "object",
        properties: {
          marca: {
            type: "string",
            description: "Marca del vehículo que el cliente quiere entregar. Ej: 'Fiat', 'Renault', 'Toyota'.",
          },
          anio: {
            type: "number",
            description: "Año/modelo del vehículo que el cliente quiere entregar. Ej: 2012.",
          },
          km: {
            type: "number",
            description: "Kilometraje del vehículo si el cliente ya lo mencionó, opcional. Ej: 130000.",
          },
        },
        required: ["marca", "anio"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agendarVisita",
      description:
        "Agenda una visita en el calendario del CRM. Usar cuando el cliente confirma día y horario para venir a la concesionaria. Si el cliente ya tenía una visita pendiente y quiere cambiarla, cancelala primero con cancelarVisita antes de llamar a esta.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre del cliente" },
          apellido: { type: "string", description: "Apellido del cliente" },
          telefono: { type: "string", description: "Teléfono del cliente" },
          vehiculo: {
            type: "string",
            description: "Auto de interés. Ej: 'Chevrolet Onix LT 2017'",
          },
          fecha: {
            type: "string",
            description: "Fecha de la visita en formato YYYY-MM-DD. Ej: '2026-06-05'",
          },
          horaInicio: {
            type: "string",
            description: "Hora de la visita en formato HH:MM. Ej: '10:30'",
          },
          notas: {
            type: "string",
            description: "Notas adicionales sobre la visita, opcional",
          },
          consultaId: {
            type: "number",
            description: "ID de la consulta asociada si ya fue creada, opcional",
          },
        },
        required: ["nombre", "apellido", "telefono", "fecha", "horaInicio"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "crearConsulta",
      description:
        "Crea una consulta en el CRM cuando el cliente mostró interés real y ya tenemos sus datos básicos.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string" },
          apellido: { type: "string" },
          telefono: { type: "string" },
          vehiculo: {
            type: "string",
            description: "Modelo de interés. Ej: 'Volkswagen Tiguan Allspace Comfortline'",
          },
          formaPago: {
            type: "string",
            description:
              "Forma de pago. Valores posibles: contado, financiado, usado, a_definir. Si son varias separarlas con coma. Ej: 'financiado,usado'",
          },
          presupuesto: {
            type: "number",
            description: "Presupuesto en ARS si lo mencionó, 0 si no",
          },
          notas: { type: "string", description: "Resumen breve de lo que busca el cliente" },
        },
        required: ["nombre", "apellido", "telefono", "vehiculo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "derivarHumano",
      description: "Deriva la conversación a un asesor humano y cambia el estado en el CRM.",
      parameters: {
        type: "object",
        properties: {
          motivo: {
            type: "string",
            description:
              "Por qué se deriva. Ej: 'Cliente pide precio de contado', 'Consulta sobre cheques'",
          },
        },
        required: ["motivo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirmarVisita",
      description:
        "Confirma la visita del cliente para hoy cuando responde afirmativamente al recordatorio. Actualiza el estado del evento a 'confirmada' y notifica al admin.",
      parameters: {
        type: "object",
        properties: {
          telefono: {
            type: "string",
            description: "Teléfono del cliente",
          },
          nuevaHora: {
            type: "string",
            description:
              "SOLO si el cliente menciona una hora de llegada distinta a la agendada (ej: 'llego a las 12' cuando el turno era 11:00). Formato HH:MM en 24hs. Si el cliente no menciona una hora distinta, omitir este campo.",
          },
        },
        required: ["telefono"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancelarVisita",
      description:
        "Cancela la visita del cliente para hoy cuando responde que no puede venir. Actualiza el estado del evento a 'cancelada'.",
      parameters: {
        type: "object",
        properties: {
          telefono: {
            type: "string",
            description: "Teléfono del cliente",
          },
          motivo: {
            type: "string",
            description: "Motivo de cancelación si lo mencionó, opcional",
          },
        },
        required: ["telefono"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "derivarSeguimientoAAsesor",
      description:
        "Usar cuando el cliente responde al mensaje de seguimiento de 7 días con algo que indica que sigue interesado o que puede llevar a una venta o consulta concreta (y no mencionó estar en contacto con otro asesor por otro medio). Deriva la conversación directo al admin (no al vendedor original, que no tiene contexto de esta respuesta).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "notificarContactoOtroMedio",
      description:
        "Usar cuando el cliente responde al mensaje de seguimiento de 7 días indicando que ya está en contacto con un asesor por otro número o medio. Avisa al admin para que lo revise.",
      parameters: {
        type: "object",
        properties: {
          detalle: {
            type: "string",
            description: "Resumen breve de lo que dijo el cliente sobre el otro contacto",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cerrarSeguimientoSinInteres",
      description:
        "Usar cuando el cliente responde al mensaje de seguimiento de 7 días diciendo que ya no está interesado, sin mencionar contacto por otro medio.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

module.exports = tools;
