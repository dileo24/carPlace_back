const OpenAI = require("openai");
const { Conversacion, Mensaje, Consulta, Auto } = require("../db");
const { formatearMiles } = require("../services/formatearAuto");
const { Op, fn, col, where: sequelizeWhere } = require("sequelize");
const buildSystemPrompt = require("./buildSystemPrompt");
const tools = require("./botTools");
const toolsReagendar = tools.filter(t =>
  ["confirmarVisita", "cancelarVisita", "agendarVisita", "crearConsulta", "buscarAuto"].includes(
    t.function.name,
  ),
);
const toolsSeguimiento7Dias = tools.filter(t =>
  ["derivarSeguimientoAAsesor", "notificarContactoOtroMedio", "cerrarSeguimientoSinInteres"].includes(
    t.function.name,
  ),
);
const { getIO } = require("./socket");
const { getDolarBlue } = require("../services/dolarBlue");
const { estadoFeriado, estadoFeriadoMultiple } = require("../services/feriados");
const { obtenerProximosDias } = require("../services/proximosDias");
const { validarFechaHoraVisita } = require("../services/horarioAtencion");
const { obtenerTodosLosUsuarioIds } = require("../services/eventoHelper");
const { quitarMarca } = require("../services/quitarMarcaVehiculo");
const hoyArgentina = require("../services/hoyArgentina");

// Frases que solo aparecen cuando el bot está tasando el vehículo que el
// cliente entrega como parte de pago — algo terminantemente prohibido por el
// prompt ("REGLA ABSOLUTA — NUNCA tasar el usado a entregar"), pero que el
// modelo igual alucina de vez en cuando. Ver uso en procesarMensaje() más
// abajo, justo antes de guardar/mandar la respuesta.
//
// Estos patrones exigen que aparezca un MONTO concreto (AR$/USD + número)
// pegado a "valor"/"tasación"/"diferencia" — no alcanza con esas palabras
// solas. Se ajustaron así después de correrlos contra ~2.900 mensajes reales
// del bot de los últimos 180 días: la versión anterior (solo por palabra)
// detectaba las 5 violaciones reales encontradas, pero también bloqueaba 18
// respuestas legítimas del tipo "la tasación se hace en persona, no puedo
// darle un número" (que ya es exactamente la respuesta correcta y no debería
// reemplazarse). Con el monto como condición, sigue detectando las 5
// violaciones reales y deja pasar las 18 legítimas.
const PATRONES_TASACION_PROHIBIDA = [
  // "valor/tasación aproximado(a) de ... AR$ 12.000.000"
  /(valor|tasaci[oó]n)\s+(aproximad[oa]|estimad[oa])[^.]{0,60}(AR\$|U\$D|USD|\$)\s?\d{1,3}[.,]\d{3}/i,
  // "valor de su Gol: AR$ 12.000.000" / "valor de su Up!... AR$ 3.875.000"
  /valor\s+de\s+su\s+[^.]{0,60}(AR\$|U\$D|USD|\$)\s?\d{1,3}[.,]\d{3}/i,
  // "diferencia a pagar: AR$ 9.300.000" / "diferencia que quedaría... AR$ X"
  /diferencia[^.]{0,80}(AR\$|U\$D|USD|\$)\s?\d{1,3}[.,]\d{3}/i,
  // "podría estar alrededor de... AR$ X" / "normalmente ronda... AR$ X"
  // (frase textual que el propio prompt ya marca como ejemplo de error)
  /(podr[ií]a\s+(estar\s+)?(alrededor|rondar)|normalmente\s+ronda|suele\s+rondar)[^.]{0,60}(AR\$|U\$D|USD|\$)\s?\d/i,
];

function contieneTasacionPropia(texto) {
  return PATRONES_TASACION_PROHIBIDA.some(re => re.test(texto));
}

// Modelo del motor conversacional (el que atiende al cliente por WhatsApp).
const MODELO_BOT = "gpt-5.6-luna";

// Mismo problema que la tasación: el prompt prohíbe confirmar descuentos o
// aceptar una contraoferta de precio, pero un texto libre nunca es 100%
// garantizable. Frases que solo aparecen cuando el bot terminó "cerrando" un
// precio o inventando una rebaja por su cuenta — algo que solo puede
// autorizar un asesor (un precio confirmado por chat puede tomarse como una
// oferta ya aceptada).
const PATRONES_DESCUENTO_NO_AUTORIZADO = [
  /le\s+(puedo\s+hacer|hago)\s+(un\s+)?descuento/i,
  /descuento\s+del\s+\d/i,
  /cerramos\s+en\s+\$?\s*\d/i,
  /trato\s+hecho/i,
  /dejo\s+en\s+\$?\s*\d/i,
];

function contieneDescuentoNoAutorizado(texto) {
  return PATRONES_DESCUENTO_NO_AUTORIZADO.some(re => re.test(texto));
}

// ── Ejecutores de tools ───────────────────────────────────────────────────────

async function ejecutarTool(nombre, args, conversacion, dolarBlue) {
  switch (nombre) {
    case "buscarAuto": {
      const busquedaRaw = args.busqueda || "";
      const { Categoria } = require("../db");

      // Variantes/typos conocidos de marcas que un cliente puede escribir mal
      // y que un LIKE normal nunca matchea (ej: transposición de letras en
      // marcas poco comunes). Sumar acá a medida que aparezcan casos reales.
      const ALIAS_MARCA = {
        dkfs: "dfsk",
        dsfk: "dfsk",
        dfks: "dfsk",
      };
      const palabras = busquedaRaw
        .toLowerCase()
        .split(" ")
        .filter(Boolean)
        .map(p => ALIAS_MARCA[p] || p);

      // LIKE contra marca/modelo ignorando guiones/puntos/espacios de ambos
      // lados — si no, "C35" nunca matchea un modelo guardado como "C-35"
      // (típico en modelos de fábrica con guión en el nombre).
      const normalizarPalabra = str => str.replace(/[-.\s]/g, "");
      const matchCampo = (campo, palabra) =>
        sequelizeWhere(
          fn("REPLACE", fn("REPLACE", fn("REPLACE", col(campo), "-", ""), ".", ""), " ", ""),
          { [Op.like]: `%${normalizarPalabra(palabra)}%` },
        );

      const whereBase = {
        estado: { [Op.in]: ["disponible", "senado"] },
        [Op.or]: [{ visible: true }, { en_alistaje: true }],
      };

      const wherePorTexto =
        palabras.length > 0
          ? {
              ...whereBase,
              [Op.and]: palabras.map(p => ({
                [Op.or]: [
                  matchCampo("marca", p),
                  matchCampo("modelo", p),
                  { anio: { [Op.like]: `%${p}%` } },
                ],
              })),
            }
          : whereBase;

      let autos = await Auto.findAll({
        where: wherePorTexto,
        include: [{ association: "categorias" }],
      });
      autos = autos.filter(a => {
        const categorias = (a.categorias || []).map(c => (c.categ || "").toLowerCase());
        return !categorias.includes("moto");
      });

      if (!autos.length && palabras.length > 0) {
        autos = await Auto.findAll({
          where: whereBase,
          include: [
            {
              model: Categoria,
              as: "categorias",
              where: {
                categ: { [Op.like]: `%${busquedaRaw}%` },
              },
              required: true,
            },
          ],
        });
      }

      if (!autos.length && palabras.length > 1) {
        const soloMarca = palabras[0];
        autos = await Auto.findAll({
          where: {
            ...whereBase,
            [Op.or]: [matchCampo("marca", soloMarca), matchCampo("modelo", soloMarca)],
          },
          include: [{ association: "categorias" }],
        });
        autos = autos.filter(a => {
          const categorias = (a.categorias || []).map(c => (c.categ || "").toLowerCase());
          return !categorias.includes("moto");
        });
      }

      if (args.precioMax) {
        const factor = args.precioMax <= 25000000 ? 1.07 : 1.05;
        args.precioMax = args.precioMax * factor;
      }

      // Limpia cualquier símbolo que no sea dígito, punto o coma (moneda, espacios,
      // etc.) ANTES de intentar parsear — así un precio mal formateado en la base
      // no rompe el parseFloat silenciosamente.
      const limpiarPrecio = str => {
        if (!str) return NaN;
        const soloNumeros = String(str).replace(/[^\d.,]/g, "");
        return parseFloat(soloNumeros.replace(/\./g, "").replace(",", "."));
      };

      if (args.precioMax || args.precioMin) {
        autos = autos.filter(a => {
          const precioEfectivo = a.oferta && a.precio_oferta ? a.precio_oferta : a.precio;
          const precioRaw = limpiarPrecio(precioEfectivo);

          // Si no se pudo determinar el precio, EXCLUIMOS el auto — antes se
          // incluía por error, dejando pasar autos fuera del presupuesto pedido.
          if (!precioRaw || Number.isNaN(precioRaw)) return false;

          const precioEnARS =
            a.moneda === "USD" || a.moneda === "U$D" ? precioRaw * (dolarBlue || 0) : precioRaw;
          if (!precioEnARS) return false;

          if (args.precioMin && precioEnARS < args.precioMin) return false;
          if (args.precioMax && precioEnARS > args.precioMax) return false;
          return true;
        });
      }

      if (args.kmMax) {
        autos = autos.filter(a => {
          if (!a.km) return true;
          const kmNum = limpiarPrecio(a.km);
          if (!kmNum || Number.isNaN(kmNum)) return true;
          return kmNum <= args.kmMax;
        });
      }

      if (args.combustible) {
        const combBuscado = args.combustible.toLowerCase();
        autos = autos.filter(a => (a.combustible || "").toLowerCase().includes(combBuscado));
      }

      // Filtro de color: convierte nombre del cliente a hex(es) para comparar contra la DB
      if (args.color) {
        const mapaColorAHex = {
          blanco: ["#FFFFFF", "#F5F5F5", "#FFFACD"],
          negro: ["#000000"],
          rojo: ["#FF0000", "#8B0000"],
          plateado: ["#C0C0C0"],
          gris: ["#808080", "#A9A9A9", "#D3D3D3"],
          azul: ["#0000FF", "#00008B", "#ADD8E6"],
          naranja: ["#FFA500"],
          borde: ["#800000"],
          verde: ["#228B22", "#006400"],
          marron: ["#D2691E"],
          champagne: ["#F0E68C"],
          beige: ["#F5DEB3", "#FFFACD"],
        };
        const colorNorm = args.color
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        const hexes = mapaColorAHex[colorNorm];
        if (hexes) {
          autos = autos.filter(a => hexes.includes((a.color || "").toUpperCase()));
        } else {
          autos = autos.filter(a =>
            (a.color || "").toLowerCase().includes(args.color.toLowerCase()),
          );
        }
      }

      if (!autos.length) return "No encontré vehículos en stock que coincidan con esa búsqueda.";

      autos.sort((a, b) => {
        const precioEfectivoA = a.oferta && a.precio_oferta ? a.precio_oferta : a.precio;
        const precioEfectivoB = b.oferta && b.precio_oferta ? b.precio_oferta : b.precio;
        const rawA = limpiarPrecio(precioEfectivoA) || 0;
        const rawB = limpiarPrecio(precioEfectivoB) || 0;
        const arsA = a.moneda === "USD" || a.moneda === "U$D" ? rawA * (dolarBlue || 0) : rawA;
        const arsB = b.moneda === "USD" || b.moneda === "U$D" ? rawB * (dolarBlue || 0) : rawB;
        return arsB - arsA;
      });

      // Registrar el vehículo de interés en el perfil apenas se identifica —
      // sin esto, quedaba sin setear hasta crearConsulta (que exige nombre
      // real), así que un cliente todavía anónimo que ya mandó un link de
      // MercadoLibre o pidió un modelo puntual no aparecía con ningún auto de
      // interés en el CRM. buscarAuto nunca se llama para el auto que el
      // cliente entrega como parte de pago (ver reglas del prompt), así que
      // esto siempre refleja un auto que quiere comprar, nunca el suyo.
      if (palabras.length > 0) {
        const modeloDetectado = `${autos[0].marca} ${autos[0].modelo}`.trim();
        // conversacion.perfil puede venir como string (JSON doblemente
        // serializado de algún update anterior) — spreadearlo tal cual lo
        // desarma carácter por carácter en vez de por sus claves.
        let perfilActual = conversacion.perfil || {};
        if (typeof perfilActual === "string") {
          try {
            perfilActual = JSON.parse(perfilActual);
          } catch {
            perfilActual = {};
          }
        }
        if (modeloDetectado && perfilActual.vehiculo?.modelo !== modeloDetectado) {
          await conversacion.update({
            perfil: { ...perfilActual, vehiculo: { modelo: modeloDetectado } },
          });
          try {
            getIO().emit("conversacion:actualizada", {
              conversacionId: conversacion.id,
              perfil: conversacion.perfil,
            });
          } catch (_) {}
        }
      }

      const mapaHexANombre = {
        "#FFFFFF": "Blanco",
        "#000000": "Negro",
        "#FF0000": "Rojo",
        "#C0C0C0": "Plateado",
        "#808080": "Gris",
        "#0000FF": "Azul",
        "#00008B": "Azul oscuro",
        "#ADD8E6": "Azul claro",
        "#A9A9A9": "Gris oscuro",
        "#D3D3D3": "Gris claro",
        "#F5F5F5": "Blanco hueso",
        "#FFA500": "Naranja",
        "#800000": "Bordó",
        "#8B0000": "Rojo oscuro",
        "#006400": "Verde oscuro",
        "#228B22": "Verde",
        "#D2691E": "Marrón",
        "#F0E68C": "Champagne",
        "#FFFACD": "Beige claro",
        "#F5DEB3": "Beige",
      };

      return autos
        .map((a, i) => {
          const km = a.km ? `${formatearMiles(a.km)} km` : null;
          const tieneOferta = a.oferta && a.precio_oferta;
          const precioLinea = tieneOferta
            ? `${a.moneda || "AR$"} ${formatearMiles(a.precio_oferta)} (precio de oferta, antes ${a.moneda || "AR$"} ${formatearMiles(a.precio)})`
            : `${a.moneda || "AR$"} ${a.precio ? formatearMiles(a.precio) : "Consultar"}`;
          const base = `${i + 1}. ${a.marca} ${a.modelo} ${a.anio}${km ? ` — ${km}` : ""} — ${precioLinea}`;

          const proximoIngreso = a.en_alistaje && !a.visible;
          const senado = a.estado === "senado";
          const notas = a.notas?.trim() ? `\n   Notas del vendedor: ${a.notas.trim()}` : "";

          const colorNombre = a.color
            ? mapaHexANombre[(a.color || "").toUpperCase()] || a.color
            : null;

          const detalles = [
            a.motor ? `Motor: ${a.motor}` : null,
            a.transmision ? `Transmisión: ${a.transmision}` : null,
            a.combustible ? `Combustible: ${a.combustible}` : null,
            colorNombre ? `Color: ${colorNombre}` : null,
          ]
            .filter(Boolean)
            .join(" | ");

          const detallesLine = detalles ? `\n   ${detalles}` : "";

          return (
            (proximoIngreso
              ? `${base} (próximo ingreso, disponible en breve)`
              : senado
                ? `${base} (SEÑADO — ya tiene una seña de otro cliente)`
                : base) +
            detallesLine +
            notas
          );
        })
        .join("\n");
    }

    case "evaluarAnioPartePago": {
      // Cálculo determinístico — antes esto lo hacía el LLM leyendo la tabla
      // del prompt en texto libre, y con modelos chicos (gpt-4o-mini) fallaba
      // repetidamente en casos reales (ej: rechazó un Fiat Uno Attractive
      // 2012 y una Renault Kangoo 2013, ambos por encima del mínimo real).
      // Mover la cuenta a código elimina esa clase de error de raíz.
      const marcaNorm = (args.marca || "").toLowerCase().trim();
      const esToyotaHonda = ["toyota", "honda"].some(m => marcaNorm.includes(m));
      const anioMinimo = esToyotaHonda ? 2005 : 2008;
      const kmMaximo = marcaNorm.includes("toyota") ? 350000 : 300000;
      const anio = Number(args.anio);

      if (!args.marca || !anio || Number.isNaN(anio)) {
        return "No se pudo evaluar: falta la marca o el año del vehículo a entregar.";
      }

      if (anio < anioMinimo) {
        return (
          `RECHAZADO por año: ${args.marca} ${anio} está por debajo del año mínimo aceptado ` +
          `para esa marca (${anioMinimo} o posterior). Decile al cliente que ese vehículo no lo ` +
          `podemos recibir como parte de pago porque el año está por debajo de lo que aceptamos ` +
          `para esa marca, y preguntale si tiene otro vehículo para entregar. No sigas pidiendo ` +
          `más datos de este vehículo.`
        );
      }

      if (args.km !== undefined && args.km !== null) {
        const km = Number(args.km);
        if (!Number.isNaN(km) && km > kmMaximo) {
          return (
            `RECHAZADO por kilometraje: ${args.marca} ${anio} con ${km} km supera el límite ` +
            `aceptado para esa marca (${kmMaximo} km). Decile al cliente que no lo podemos recibir ` +
            `como parte de pago por el kilometraje, y preguntale si tiene otro vehículo para entregar.`
          );
        }
      }

      return (
        `ACEPTADO: ${args.marca} ${anio} cumple el año mínimo aceptado para esa marca ` +
        `(${anioMinimo} o posterior)${args.km ? ` y está dentro del límite de kilómetros (hasta ${kmMaximo})` : ""}. ` +
        `NUNCA digas que se rechaza por año en este caso — seguí pidiendo los datos que falten ` +
        `(km si no lo dio, estado general, deuda, prenda) antes de derivar a un asesor.`
      );
    }

    case "crearConsulta": {
      if (conversacion.consultaId) {
        // El chat puede seguir vinculado a una consulta vieja que ya se cerró
        // o perdió (ej: el cliente cerró una compra hace meses y vuelve a
        // escribir por otra cosa) — en ese caso no bloqueamos, se crea una
        // consulta nueva y el vínculo se reemplaza más abajo. Si la vinculada
        // todavía está activa, ahí sí ya existe y no corresponde crear otra.
        const { ESTADOS_ACTIVOS } = require("../services/consultasHelper");
        const consultaVinculada = await Consulta.findByPk(conversacion.consultaId);
        if (consultaVinculada && ESTADOS_ACTIVOS.includes(consultaVinculada.estado)) {
          return "La consulta ya fue creada anteriormente.";
        }
      }

      const nombresInvalidos = [
        "cliente",
        "no disponible",
        "anónimo",
        "anonimo",
        "sin nombre",
        "desconocido",
      ];
      const nombreNorm = (args.nombre || "").toLowerCase().trim();
      if (!args.nombre || nombresInvalidos.some(n => nombreNorm.includes(n))) {
        return "No se puede crear la consulta sin el nombre real del cliente. Pedíselo primero.";
      }

      const splitNombreApellido = require("../services/splitNombreApellido");
      const { nombre: nombreLimpio, apellido: apellidoLimpio } = splitNombreApellido(
        args.nombre,
        args.apellido,
      );

      const { buscarConsultaActiva } = require("../services/consultasHelper");
      // Usamos el teléfono real de la conversación (verificado por WhatsApp),
      // nunca el que extrajo el LLM del texto — si el cliente menciona otro
      // número (un fijo, un typo, el de un tercero) y confiáramos en args.telefono,
      // la consulta queda con un teléfono ajeno y más adelante puede "atraer"
      // por error a otra conversación real que sí tenga ese número.
      const consultaActivaExistente = await buscarConsultaActiva(conversacion.telefono);

      if (consultaActivaExistente) {
        await conversacion.update({
          consultaId: consultaActivaExistente.id,
          contactoNombre: conversacion.contactoNombre || consultaActivaExistente.nombre,
          contactoApellido: conversacion.contactoApellido || consultaActivaExistente.apellido,
        });
        try {
          getIO().emit("conversacion:actualizada", {
            conversacionId: conversacion.id,
            consultaId: consultaActivaExistente.id,
          });
        } catch (_) {}
        return `Ya existía una consulta activa para este cliente (uso interno: ID ${consultaActivaExistente.id}), se vinculó a la conversación. Nunca menciones este ID al cliente.`;
      }
      // Normalizar formaPago a array
      const rawFormaPago = args.formaPago || "a_definir";
      const formaPago = rawFormaPago
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

      const normalizarTelefonoConsulta = require("../services/normalizarTelefono");
      const consulta = await Consulta.create({
        nombre: nombreLimpio,
        apellido: apellidoLimpio,
        telefono: normalizarTelefonoConsulta(conversacion.telefono),
        vehiculo: args.vehiculo,
        formaPago,
        presupuesto: args.presupuesto || 0,
        origen: conversacion.origen || args.origen || "WhatsApp",
        estado: "nuevo",
        cargadoPor: "bot",
        asesorId: null,
        notas: args.notas || null,
      });
      if (args.origen && args.origen !== "WhatsApp" && !conversacion.origen) {
        await conversacion.update({ origen: args.origen });
        try {
          getIO().emit("conversacion:actualizada", {
            conversacionId: conversacion.id,
            origen: args.origen,
          });
        } catch (_) {}
      }

      let perfilPrevio = conversacion.perfil || {};
      if (typeof perfilPrevio === "string") {
        try {
          perfilPrevio = JSON.parse(perfilPrevio);
        } catch {
          perfilPrevio = {};
        }
      }
      await conversacion.update({
        consultaId: consulta.id,
        contactoNombre: nombreLimpio,
        contactoApellido: apellidoLimpio,
        perfil: {
          ...perfilPrevio,
          vehiculo: { modelo: args.vehiculo },
          // Usa el array ya normalizado (formaPago), no args.formaPago crudo —
          // si el cliente pidió "financiado,usado" a la vez, args.formaPago ===
          // "financiado" es false y esto quedaba en false por error.
          financiacion: formaPago.includes("financiado"),
        },
      });

      return `Consulta creada correctamente (uso interno: ID ${consulta.id}). Nunca menciones este ID al cliente.`;
    }

    case "derivarHumano": {
      await conversacion.update({ estado: "asesor" });

      try {
        getIO().emit("conversacion:derivada", {
          conversacionId: conversacion.id,
          motivo: args.motivo,
          ultimaActividad: new Date(),
        });
      } catch (_) {}

      const { notificarAdmin } = require("../services/notificacionAdmin");
      const nombre = conversacion.contactoNombre
        ? `${conversacion.contactoNombre}${conversacion.contactoApellido ? " " + conversacion.contactoApellido : ""}`
        : conversacion.telefono;
      notificarAdmin(
        `🔔 El bot derivó una conversación a asesor\n🙋 Cliente: ${nombre}\n📋 Motivo: ${args.motivo}`,
      ).catch(() => {});

      const generarResumen = require("./generarResumen");
      generarResumen(conversacion.id).catch(err =>
        console.warn("⚠️ No se pudo generar resumen IA:", err.message),
      );
      return `Conversación derivada a humano. Motivo: ${args.motivo}`;
    }

    case "agendarVisita": {
      const nombresInvalidos = [
        "cliente",
        "no disponible",
        "anónimo",
        "anonimo",
        "sin nombre",
        "desconocido",
      ];
      const nombreNorm = (args.nombre || "").toLowerCase().trim();
      if (!args.nombre || nombresInvalidos.some(n => nombreNorm.includes(n))) {
        return "No se puede agendar la visita sin el nombre real del cliente. Pedíselo primero.";
      }

      // Red de seguridad server-side: hasta acá esta regla vivía solo como
      // texto en el prompt, y el LLM podía (y llegó a) agendar fuera de
      // horario de atención (ej. sábados, o fuera de las franjas horarias).
      const validacionHorario = await validarFechaHoraVisita(args.fecha, args.horaInicio);
      if (!validacionHorario.valida) {
        return `No se pudo agendar la visita: ${validacionHorario.motivo} Proponele al cliente otro día/horario dentro del horario de atención.`;
      }

      const { EventoCalendario, Consulta } = require("../db");
      const { notificarAdmin } = require("../services/notificacionAdmin");
      const normalizarTelefono = require("../services/normalizarTelefono");

      const BOT_USUARIO_ID = process.env.BOT_USUARIO_ID || null;

      const splitNombreApellido = require("../services/splitNombreApellido");
      const { nombre: nombreLimpio, apellido: apellidoLimpio } = splitNombreApellido(
        args.nombre,
        args.apellido,
      );

      // El LLM no siempre repite el vehículo si ya se había mencionado antes
      // en la conversación (ej: "sí, agendame para el sábado a las 10"), así
      // que si no vino en args lo recuperamos de la consulta ya vinculada.
      let vehiculoParaEvento = args.vehiculo || null;
      if (!vehiculoParaEvento && conversacion.consultaId) {
        const consultaVinculada = await Consulta.findByPk(conversacion.consultaId);
        vehiculoParaEvento = consultaVinculada?.vehiculo || null;
      }

      const modeloSinMarca = await quitarMarca(vehiculoParaEvento);
      const nuevoEvento = await EventoCalendario.create({
        titulo: `Visita${modeloSinMarca ? ` — ${modeloSinMarca}` : ""} — ${nombreLimpio} ${apellidoLimpio}`,

        tipo: "visita",
        fecha: args.fecha,
        horaInicio: args.horaInicio,
        estado: "pendiente",
        clienteNombre: nombreLimpio,
        clienteApellido: apellidoLimpio,
        clienteTelefono: normalizarTelefono(conversacion.telefono),
        vehiculo: vehiculoParaEvento,
        notas: args.notas || null,
        consultaId: args.consultaId || conversacion.consultaId || null,
        conversacionId: conversacion.id,
        usuarioId: BOT_USUARIO_ID ? Number(BOT_USUARIO_ID) : null,
        creadoPorId: BOT_USUARIO_ID ? Number(BOT_USUARIO_ID) : null,
        creadoPorRol: "vendedor",
        invitadosIds: await obtenerTodosLosUsuarioIds(),
      });

      // Vincular o crear consulta según corresponda
      let consultaCreada = false;
      if (!conversacion.consultaId) {
        const { buscarConsultaActiva } = require("../services/consultasHelper");
        // Mismo criterio que en crearConsulta: el teléfono verificado de la
        // conversación, nunca el que haya dicho el LLM que extrajo del texto.
        const consultaActivaExistente = await buscarConsultaActiva(conversacion.telefono);

        if (consultaActivaExistente) {
          await conversacion.update({ consultaId: consultaActivaExistente.id });
          await nuevoEvento.update({ consultaId: consultaActivaExistente.id });
        } else {
          const consulta = await Consulta.create({
            nombre: nombreLimpio,
            apellido: apellidoLimpio,
            telefono: normalizarTelefono(conversacion.telefono),
            vehiculo: args.vehiculo || null,
            formaPago: ["a_definir"],
            presupuesto: 0,
            origen: conversacion.origen || "WhatsApp",
            estado: "nuevo",
            cargadoPor: "bot",
            asesorId: null,
            notas: args.notas || null,
          });
          await conversacion.update({ consultaId: consulta.id });
          await nuevoEvento.update({ consultaId: consulta.id });
          consultaCreada = true;
        }
      }

      // Marcar como derivada y guardar origen en un solo update
      const updateData = { estado: "asesor" };
      if (args.origen && args.origen !== "WhatsApp" && !conversacion.origen) {
        updateData.origen = args.origen;
      }
      await conversacion.update(updateData);

      try {
        getIO().emit("conversacion:derivada", {
          conversacionId: conversacion.id,
          ultimaActividad: new Date(),
          ...(updateData.origen ? { origen: updateData.origen } : {}),
        });
      } catch (_) {}

      try {
        getIO().emit("calendario:actualizado");
      } catch (_) {}

      // Notificar al admin
      const fechaStr = new Date(`${args.fecha}T00:00:00`).toLocaleDateString("es-AR", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const cliente = [args.nombre, args.apellido].filter(Boolean).join(" ");
      notificarAdmin(
        `🤖 *El bot agendó una visita*${consultaCreada ? " *y creó una consulta*" : ""}\n` +
          `🏷️ ${nuevoEvento.titulo}\n` +
          `🗓️ ${fechaStr} a las ${args.horaInicio} hs\n` +
          (cliente ? `🙋 Cliente: ${cliente}\n` : "") +
          (args.vehiculo ? `🚗 ${args.vehiculo}\n` : "") +
          (args.notas ? `📝 ${args.notas}\n` : ""),
      ).catch(() => {});

      const generarResumen = require("./generarResumen");
      generarResumen(conversacion.id).catch(err =>
        console.warn("⚠️ No se pudo generar resumen IA:", err.message),
      );

      return `Visita agendada para el ${args.fecha} a las ${args.horaInicio} hs (uso interno: ID del evento ${nuevoEvento.id}). Nunca menciones este ID al cliente.`;
    }

    case "confirmarVisita": {
      const { EventoCalendario } = require("../db");
      const hoy = hoyArgentina();
      const telefono = conversacion.telefono;
      const telefonoSin549 = telefono.replace(/^549/, "");
      const telefonoSin54 = telefono.replace(/^54/, "");
      const telefonoSinGuiones = telefonoSin549.replace(/[-\s]/g, "");
      const telefonoConPrefijo = "549" + telefonoSinGuiones;

      const horaValida = typeof args.nuevaHora === "string" && /^\d{1,2}:\d{2}$/.test(args.nuevaHora.trim());
      const nuevaHora = horaValida ? args.nuevaHora.trim() : null;

      if (nuevaHora) {
        const validacionHorario = await validarFechaHoraVisita(hoy, nuevaHora);
        if (!validacionHorario.valida) {
          return `No se pudo reagendar: ${validacionHorario.motivo} Proponele al cliente otro horario dentro del horario de atención.`;
        }
      }

      const adminTelefono = process.env.ADMIN_WHATSAPP;
      if (adminTelefono) {
        const evento = await EventoCalendario.findOne({
          where: { clienteTelefono: telefono, fecha: hoy },
        });
        if (evento) {
          const cliente = `${evento.clienteNombre || ""} ${evento.clienteApellido || ""}`.trim();
          const vehiculo = evento.vehiculo ? ` — ${evento.vehiculo}` : "";
          const horaAviso = nuevaHora ? `${nuevaHora} hs (cambiada desde ${evento.horaInicio})` : `${evento.horaInicio} hs`;
          const msg = `✅ Visita confirmada\n${cliente}${vehiculo}\n🕐 ${horaAviso}`;
          try {
            const { sendWhatsAppMessage } = require("../services/whatsapp");
            await sendWhatsAppMessage(adminTelefono, msg);
          } catch (_) {}
        }
      }
      await EventoCalendario.update(
        {
          estado: "confirmada",
          esperandoConfirmacion: false,
          ...(nuevaHora ? { horaInicio: nuevaHora } : {}),
        },
        {
          where: {
            [Op.or]: [
              { clienteTelefono: telefono },
              { clienteTelefono: telefonoSin549 },
              { clienteTelefono: telefonoSin54 },
              { clienteTelefono: telefonoSinGuiones },
              { clienteTelefono: telefonoConPrefijo },
            ],
            fecha: hoy,
            estado: "pendiente",
          },
        },
      );

      try {
        getIO().emit("calendario:actualizado");
      } catch (_) {}

      return nuevaHora
        ? `Visita confirmada correctamente, horario actualizado a las ${nuevaHora} hs.`
        : "Visita confirmada correctamente.";
    }

    case "cancelarVisita": {
      const { EventoCalendario } = require("../db");
      const hoy = hoyArgentina();
      const telefono = conversacion.telefono; // ej: "5493513775379"

      // Generar variantes para matchear cualquier formato guardado en el evento
      const telefonoSin549 = telefono.replace(/^549/, "");
      const telefonoSin54 = telefono.replace(/^54/, "");
      const telefonoConEspacios = telefonoSin549.replace(
        // "3513 77 53 79"
        /(\d{4})(\d{2})(\d{2})(\d{2})/,
        "$1 $2 $3 $4",
      );
      const telefonoConEspacios351 = telefonoSin549.replace(
        // "351 77 53 79"
        /(\d{3})(\d{2})(\d{2})(\d{2})/,
        "$1 $2 $3 $4",
      );
      const telefonoSinGuiones = telefonoSin549.replace(/[-\s]/g, "");
      const telefonoConPrefijo = "549" + telefonoSinGuiones;

      await EventoCalendario.update(
        { estado: "cancelada", esperandoConfirmacion: false },
        {
          where: {
            [Op.or]: [
              { clienteTelefono: telefono },
              { clienteTelefono: telefonoSin549 },
              { clienteTelefono: telefonoSin54 },
              { clienteTelefono: telefonoConEspacios },
              { clienteTelefono: telefonoConEspacios351 },
              { clienteTelefono: telefonoSinGuiones },
              { clienteTelefono: telefonoConPrefijo },
            ],
            fecha: hoy,
            estado: { [Op.in]: ["pendiente", "confirmada"] },
          },
        },
      );

      try {
        getIO().emit("calendario:actualizado");
      } catch (_) {}

      return "Visita cancelada correctamente.";
    }

    // ── Respuesta al mensaje de seguimiento de 7 días ───────────────────────────
    // Estas 3 tools son mutuamente excluyentes — el bot llama a una sola. Marcan
    // conversacion._ocultarRespuestaSeguimiento para que procesarMensaje() sepa
    // si tiene que ocultarle al vendedor el intercambio (ver más abajo).
    case "derivarSeguimientoAAsesor": {
      // Se desasigna del vendedor original y se deriva directo al admin: el
      // mensaje del seguimiento (la pregunta "¿ya lo contactó un asesor?")
      // queda siempre oculto para vendedores (ver getConversaciones.js), así
      // que si esto quedara asignado al mismo vendedor, vería solo la
      // respuesta del cliente ("No", "queremos un etios") sin la pregunta que
      // la origina y no entendería el contexto. Al limpiar asesorId, la
      // conversación deja de aparecer en la lista de ese vendedor y solo la
      // ven admin/supervisor (que sí ven el intercambio completo).
      await conversacion.update({
        esperandoRespuestaSeguimiento7Dias: false,
        asesorId: null,
        asesorNombre: null,
        asesorApellido: null,
      });
      conversacion._ocultarRespuestaSeguimiento = false;
      try {
        // "soltada" (no "estadoCambiado"): ese evento solo parchea
        // estado/asesorNombre en las filas que el vendedor ya tenía cargadas
        // localmente, sin quitar la conversación de su lista. "soltada" fuerza
        // un refetch al backend, que es lo que realmente la saca de su vista
        // (getConversaciones.js ya no se la devuelve sin asesorId asignado).
        getIO().emit("conversacion:soltada", { conversacionId: conversacion.id });
      } catch (_) {}
      const { notificarAdmin } = require("../services/notificacionAdmin");
      const nombreCliente =
        [conversacion.contactoNombre, conversacion.contactoApellido].filter(Boolean).join(" ") ||
        conversacion.telefono;
      notificarAdmin(
        `🔔 ${nombreCliente} respondió al seguimiento de 7 días y sigue interesado. Se derivó directo al admin (se desasignó del vendedor original, que no tiene el contexto de la pregunta).`,
      ).catch(() => {});
      return "El cliente sigue interesado. Se derivó la conversación directo al admin.";
    }

    case "notificarContactoOtroMedio": {
      await conversacion.update({ esperandoRespuestaSeguimiento7Dias: false });
      conversacion._ocultarRespuestaSeguimiento = true;
      const { notificarAdmin } = require("../services/notificacionAdmin");
      const nombreCliente =
        [conversacion.contactoNombre, conversacion.contactoApellido].filter(Boolean).join(" ") ||
        conversacion.telefono;
      notificarAdmin(
        `📵 Seguimiento de 7 días: ${nombreCliente} dijo que ya está en contacto con un asesor por otro medio.` +
          (args.detalle ? `\n📝 ${args.detalle}` : ""),
      ).catch(() => {});
      return "El cliente ya está en contacto con un asesor por otro medio. Avisado al admin.";
    }

    case "cerrarSeguimientoSinInteres": {
      await conversacion.update({ esperandoRespuestaSeguimiento7Dias: false });
      conversacion._ocultarRespuestaSeguimiento = true;
      return "El cliente ya no está interesado. Seguimiento cerrado.";
    }

    default:
      return "Tool no reconocida.";
  }
}

// ── Función principal ─────────────────────────────────────────────────────────

async function procesarMensaje(conversacionId, textoEntrante) {
  const esMediaSinTexto =
    !textoEntrante ||
    textoEntrante.trim() === "" ||
    /^\[(imagen|foto|video|sticker|documento)\]$/i.test(textoEntrante.trim());

  if (esMediaSinTexto) {
    console.log(`📷 Conversación ${conversacionId}: media sin texto, esperando mensaje.`);
    return null;
  }

  const dolarBlue = await getDolarBlue();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const conversacion = await Conversacion.findByPk(conversacionId, {
      include: [
        {
          association: "mensajes",
        },
      ],
      order: [[{ model: require("../db").Mensaje, as: "mensajes" }, "timestamp", "ASC"]],
    });

    if (!conversacion) throw new Error("Conversación no encontrada");

    const { EventoCalendario } = require("../db");
    const hoy = hoyArgentina();
    const telefonoNormalizado = conversacion.telefono; // ya viene normalizado con 549

    const eventoHoy = await EventoCalendario.findOne({
      where: {
        [Op.or]: [
          { clienteTelefono: telefonoNormalizado },
          { clienteTelefono: telefonoNormalizado.replace(/^549/, "") }, // sin 549
          { clienteTelefono: telefonoNormalizado.replace(/^54/, "") }, // sin 54
        ],
        fecha: hoy,
        esperandoConfirmacion: true,
      },
    });

    const esperandoConfirmacion = !!eventoHoy;
    const esperandoSeguimiento7Dias = !esperandoConfirmacion && conversacion.esperandoRespuestaSeguimiento7Dias;

    if (conversacion.estado !== "bot" && !esperandoConfirmacion && !esperandoSeguimiento7Dias) {
      try {
        await Mensaje.update(
          { procesado: true },
          { where: { conversacionId: conversacionId, procesado: false, tipo: "entrante" } },
        );
      } catch (_) {}
      return null;
    }

    const hoyISO = hoyArgentina();
    const estadoHoy = await estadoFeriado(hoyISO);

    // Traer el estado de feriado de los próximos 14 días de una sola vez
    // (estadoFeriadoMultiple evita 14 fetches concurrentes a la API de feriados)
    const proximosDias = obtenerProximosDias(14);
    const estadosFeriados = await estadoFeriadoMultiple(proximosDias.map(d => d.iso));
    const mapaFeriados = new Map(estadosFeriados.map(e => [e.fecha, e.estado]));
    const diasConEstado = proximosDias.map(d => ({
      ...d,
      estadoFeriado: mapaFeriados.get(d.iso) || null,
    }));

    const tablaDiasTextoConfirmacion = diasConEstado
      .map(d => {
        const etiquetaFeriado =
          d.estadoFeriado === "cerrado"
            ? " — FERIADO, CERRADO"
            : d.estadoFeriado === "solo_maniana"
              ? " — FERIADO, solo 9:30 a 13:00"
              : "";
        return `${d.nombreDia}${d.esHoy ? " (HOY)" : ""} = ${d.iso}${etiquetaFeriado}`;
      })
      .join("\n");

    const systemPrompt = esperandoConfirmacion
      ? `Sos el asistente de Car Place. Hoy es ${hoy}. El cliente está respondiendo al recordatorio de su visita de hoy.
    Datos de la visita: ${eventoHoy.clienteNombre} ${eventoHoy.clienteApellido || ""}${eventoHoy.vehiculo ? ` — interesado en ${eventoHoy.vehiculo}` : ""} — ${eventoHoy.horaInicio} hs.

    confirmarVisita y cancelarVisita son EXCLUYENTES: nunca las llames juntas — son
    mutuamente contradictorias, la segunda pisa el resultado de la primera.

    NUNCA respondas con frases como "voy a cancelar la visita", "dame un momento",
    "ya te confirmo" o cualquier promesa de una acción que no ejecutaste en ESTE
    MISMO turno — si lo decís sin llamar la tool correspondiente ahora, la acción no
    se ejecuta y el cliente se queda esperando una confirmación que nunca llega. Cada
    tool que menciones en tu respuesta tiene que estar llamada en el mismo turno,
    nunca pospuesta para "después".

    Si el cliente pide cambiar el día u horario de la visita de hoy en un solo
    mensaje (ej: "¿puedo ir mañana a las 16?", "mejor el jueves"), eso es a la vez
    una cancelación de la visita de hoy Y una fecha nueva concreta: llamá
    cancelarVisita y agendarVisita JUNTAS en ese mismo turno (no son excluyentes
    entre sí, solo confirmarVisita y cancelarVisita lo son), y respondé confirmando
    directamente la fecha/hora nueva — nunca dividas esto en "primero cancelo, después
    te pregunto" si el cliente ya te dio la fecha nueva en el mismo mensaje.

    Si el cliente da SOLO un horario o rango horario (ej: "puedo entre las 16 y 18",
    "mejor a las 17hs") SIN mencionar ningún día ni palabra relativa de fecha
    ("mañana", "el jueves", "la semana que viene"), eso sigue refiriéndose a la visita
    de HOY — NUNCA asumas otro día en ese caso. Si corresponde reagendar, llamá
    cancelarVisita y agendarVisita juntas usando fecha: "${hoy}" literal (nunca
    "mañana" ni ningún otro día) y el horario nuevo que dio. Solo usá un día distinto
    de "${hoy}" si el cliente lo nombra explícitamente en su mensaje.

    Tu respuesta de texto es SOLO el mensaje natural para el cliente. NUNCA agregues
    anotaciones, marcas ni referencias a qué tool llamaste (ej: "[llamada a
    confirmarVisita]", "(confirmarVisita)", "🔔 tool ejecutada") — eso es un detalle
    interno que el cliente jamás debe ver. Llamá la tool por su mecanismo normal,
    aparte del texto, nunca mencionándola dentro del mensaje.

    Si la respuesta es solo un saludo, un genérico "ok"/"gracias"/"dale", o cualquier
    mensaje que NO diga ni implique explícitamente si va a venir o no (ej: "Buen día",
    "Hola", un emoji sin contexto) → NO llames a confirmarVisita ni a cancelarVisita
    todavía. Un saludo no es una confirmación. Respondé preguntando directamente:
    "¡Buen día! ¿Confirma que nos puede visitar hoy a las ${eventoHoy.horaInicio} hs?"
    Ejemplo del error a evitar:
    Cliente responde solo "Buen día!" al recordatorio.
    Incorrecto: llamar a confirmarVisita (un saludo no confirma nada).
    Correcto: preguntar directamente si confirma la visita, sin llamar ninguna tool
    todavía.

    Si confirma que viene, dice que ya llegó, que está en el local/concesionario, que
    está en camino, o cualquier variante que indique explícitamente que sí va a venir
    (aunque no use la palabra "confirmo") → llamá SOLO a confirmarVisita.
    Si en ese mismo mensaje el cliente menciona una hora de llegada DISTINTA a la
    agendada (ej: el turno es a las ${eventoHoy.horaInicio} y dice "llego a las 12", "voy
    una hora más tarde", "puedo un poco después"): pasá esa hora nueva en el campo
    nuevaHora de confirmarVisita (formato HH:MM), y respondé confirmando ESA hora nueva,
    nunca la original — ej: "Perfecto, no hay problema, lo esperamos a las 12:00 en Av.
    Caraffa 2247. ¡Hasta luego!". Si no menciona ninguna hora distinta, respondé
    "Perfecto, lo esperamos a las ${eventoHoy.horaInicio} en Av. Caraffa 2247. ¡Hasta
    luego!" sin pasar nuevaHora.

    Si cancela o no puede y NO dio un día/horario nuevo en ese mismo mensaje → llamá
    SOLO a cancelarVisita y en ESE MISMO mensaje preguntale directamente qué otro día y
    horario le queda cómodo para venir. NUNCA elijas vos un día u horario, ni digas
    frases como "reprogramé para..." o "lo esperamos mañana..." — tu único rol acá es
    cancelar y preguntar, nunca reagendar sin que el cliente haya dado explícitamente
    un día y horario nuevo en su respuesta. Si SÍ dio un día/horario nuevo concreto en
    el mismo mensaje en el que cancela o pide cambiar, aplicá la regla de arriba:
    cancelarVisita + agendarVisita juntas, ya. NUNCA derives a un asesor humano en este
    flujo — vos manejás la reprogramación directamente, sin excepciones.

    Recién cuando el cliente responda con un día y horario concreto → llamá a
    agendarVisita con nombre: "${eventoHoy.clienteNombre}", apellido: "${eventoHoy.clienteApellido || ""}", vehiculo: "${eventoHoy.vehiculo || ""}", telefono: "${conversacion.telefono}".
    La fecha en agendarVisita SIEMPRE debe ser YYYY-MM-DD real. NUNCA calcules el offset
    de días vos mismo — usá esta tabla para traducir el día que dijo el cliente a la
    fecha exacta:

    ${tablaDiasTextoConfirmacion}

    Cada nombre de día aparece DOS VECES en la tabla (cubre 2 semanas). La tabla arranca
    en HOY y solo lista fechas hacia adelante — NUNCA contiene un día ya pasado. Por eso
    la PRIMERA aparición de ese día es SIEMPRE la fecha correcta (la próxima vez que cae
    ese día). Usá la SEGUNDA aparición ÚNICAMENTE si el cliente pide explícitamente esa
    semana más lejana ("el viernes que viene", "la semana siguiente") — nunca por otro
    motivo.

    Si el cliente da el número de día explícito (ej: "Martes 27", "el 27"), ese número
    manda SIEMPRE sobre cualquier palabra relativa ("mañana") que haya usado antes —
    buscá en la tabla la fila cuyo ISO termine en ese número y usá esa fecha exacta.
    Nunca calcules "mañana" por tu cuenta cuando el cliente ya dio el número explícito.

    Si la tabla marca un día como feriado con "CERRADO", no ofrezcas ese día — avisale
    que ese día no atendemos y pedile otra opción. Los sábados y domingos el local
    permanece cerrado siempre — tampoco los ofrezcas ni los agendes.

    Si en cualquier momento el cliente pregunta algo distinto (otro auto, precio, financiación, stock), respondé esa consulta con normalidad usando buscarAuto si hace falta, y después retomá el tema de la visita.
    Si durante la conversación necesitás crear una consulta, usá nombre: "${eventoHoy.clienteNombre}", apellido: "${eventoHoy.clienteApellido || ""}", vehiculo: "${eventoHoy.vehiculo || ""}".
    Si la respuesta es ambigua → preguntale directamente si va a poder venir hoy.
    Sé muy breve. Una o dos líneas máximo.`
      : esperandoSeguimiento7Dias
        ? `Sos el asistente de Car Place. El cliente está respondiendo al mensaje de
    seguimiento que le mandamos porque pasaron 7 días sin actividad en esta conversación
    (le preguntamos si sigue interesado en el vehículo y si ya está en contacto con un
    asesor por otro número de WhatsApp). Tenés que clasificar su respuesta y llamar a
    UNA sola de estas tools — nunca más de una:

    - derivarSeguimientoAAsesor: si dice que sigue interesado, quiere avanzar, o
      cualquier cosa que pueda derivar en una venta o consulta concreta — y NO
      mencionó estar en contacto con otro asesor por otro medio.
    - notificarContactoOtroMedio: si menciona que ya está hablando con alguien de
      Car Place por otro número o medio (aunque también diga que sigue interesado).
      Pasá en "detalle" un resumen breve de una línea de lo que dijo.
    - cerrarSeguimientoSinInteres: si dice que ya no le interesa, sin mencionar
      contacto por otro medio.

    Si la respuesta es ambigua y no podés clasificarla con ninguna de las tres,
    preguntale directamente: "¿Sigue interesado en el vehículo, o ya está en contacto
    con alguno de nuestros asesores por otro número?" — sin llamar ninguna tool todavía.

    Después de llamar la tool que corresponda, respondé al cliente con un mensaje corto
    y cordial acorde (agradecer, confirmar que un asesor se va a poner en contacto — sin
    decir "el mismo asesor" ni nombrarlo, porque puede ser uno distinto al que ya
    conocía — o despedirte cordialmente según el caso). Máximo 2 líneas. Nunca uses
    "usted" y "vos" mezclados — usá "usted", igual que el resto de la comunicación de
    la marca.`
        : buildSystemPrompt(dolarBlue, estadoHoy, diasConEstado);
    // Construir historial para OpenAI (últimos 20 mensajes para no explotar el context)
    const mensajes = (conversacion.mensajes || []).slice(-20);

    const historial = mensajes.map((m, i) => {
      let content = m.texto;
      // Si es un mensaje del contacto con link enriquecido y el bot ya respondió después,
      // simplificarlo para que no confunda al bot en turnos posteriores
      if (
        m.autor === "contacto" &&
        content.includes("[El cliente mandó este link:") &&
        mensajes[i + 1]?.autor === "bot"
      ) {
        // Quedarse solo con el texto antes del link
        content = content.split("\n[El cliente mandó este link:")[0].trim() || content;
      }
      return {
        role: m.autor === "contacto" ? "user" : "assistant",
        content,
      };
    });
    // Agregar el mensaje nuevo al historial
    historial.push({ role: "user", content: textoEntrante });

    // ── Primera llamada a OpenAI ──────────────────────────────────────────────
    // reasoning_effort: "none" — gpt-5.6-luna (y otros modelos con razonamiento)
    // no permiten function tools en /v1/chat/completions salvo que se desactive
    // el razonamiento explícitamente; sin esto, cualquier mensaje que dispare
    // una tool (buscarAuto, derivarHumano, etc. — o sea, casi todos) tira 400.
    let response = await openai.chat.completions.create({
      model: MODELO_BOT,
      messages: [{ role: "system", content: systemPrompt }, ...historial],
      tools: esperandoConfirmacion ? toolsReagendar : esperandoSeguimiento7Dias ? toolsSeguimiento7Dias : tools,
      tool_choice: "auto",
      reasoning_effort: "none",
    });

    let mensaje = response.choices[0].message;
    const nombresToolsLlamadas = [];

    // ── Loop de tools (OpenAI puede llamar varias tools en secuencia) ─────────
    while (mensaje.tool_calls?.length) {
      const toolResults = [];

      for (const call of mensaje.tool_calls) {
        const args = JSON.parse(call.function.arguments);
        console.log(`🔧 Tool: ${call.function.name}`, args);
        nombresToolsLlamadas.push(call.function.name);

        const resultado = await ejecutarTool(call.function.name, args, conversacion, dolarBlue);

        toolResults.push({
          role: "tool",
          tool_call_id: call.id,
          content: resultado,
        });
      }

      // Segunda llamada con resultados de tools
      response = await openai.chat.completions.create({
        model: MODELO_BOT,
        messages: [
          { role: "system", content: systemPrompt },
          ...historial,
          mensaje,
          ...toolResults,
        ],
        tools: esperandoConfirmacion ? toolsReagendar : esperandoSeguimiento7Dias ? toolsSeguimiento7Dias : tools,
        tool_choice: "auto",
        reasoning_effort: "none",
      });

      mensaje = response.choices[0].message;
    }

    let textoRespuesta = mensaje.content?.trim();
    if (!textoRespuesta) return null;
    // Red de seguridad: a veces el modelo se "confunde" y deja una anotación
    // interna tipo "🔔 [llamada a confirmarVisita]" pegada a la respuesta —
    // el cliente no tiene que ver eso nunca, aunque el prompt ya se lo prohíba.
    textoRespuesta = textoRespuesta.replace(/\n*(?:🔔\s*)?\[llamada a [^\]]+\]\s*$/i, "").trim();
    // Red de seguridad — el prompt prohíbe usar markdown (WhatsApp no lo
    // renderiza), pero el modelo a veces igual pone encabezados "###" que
    // llegan al cliente como texto literal con los numerales. Bold/italic
    // (**x**/__x__) se convierten a la sintaxis que sí entiende WhatsApp
    // (*x*/_x_); los encabezados no tienen equivalente, así que se les saca
    // el "#" y se dejan como texto plano.
    let textoWA = textoRespuesta
      .replace(/\*\*(.*?)\*\*/g, "*$1*")
      .replace(/__(.*?)__/g, "_$1_")
      .replace(/^#{1,6}\s*/gm, "");

    // Red de seguridad — "es el primer mensaje del bot en la conversación" es
    // un hecho verificable con el historial (a diferencia de las anteriores,
    // que dependen de interpretar texto libre), así que acá no hace falta
    // adivinar: si corresponde presentación y el modelo la salteó (pasa
    // cuando responde directo a la consulta y se olvida de identificarse),
    // se la anteponemos nosotros. El cliente tiene que poder identificar que
    // habla con un bot desde el primer mensaje, siempre.
    const esPrimerMensajeBot = !(conversacion.mensajes || []).some(m => m.autor === "bot");
    if (esPrimerMensajeBot && !esperandoConfirmacion && !esperandoSeguimiento7Dias && !/asistente\s+virtual/i.test(textoWA)) {
      // Si el modelo ya puso un "¡Hola!" suelto (con o sin el emoji) antes de
      // saltear la presentación, lo sacamos para no terminar con dos saludos.
      const textoSinSaludoSuelto = textoWA.replace(/^¡?hola!?\s*(🤖\s*)?/i, "").trim();
      textoWA = `¡Hola! Soy el asistente virtual de Car Place 🤖. ${textoSinSaludoSuelto}`;
      console.warn(`⚠️ Bot omitió la presentación inicial en conv ${conversacion.id} — se antepuso automáticamente.`);
    }

    // Red de seguridad — el prompt YA prohíbe explícitamente tasar el
    // vehículo que el cliente entrega como parte de pago ("ni siquiera
    // aproximado"), pero el modelo lo sigue haciendo de vez en cuando de
    // todas formas (alucina un valor y una "diferencia a pagar" que nadie le
    // dio). Una instrucción en texto libre nunca se puede garantizar al
    // 100% — así que acá se bloquea a nivel de código: si el texto generado
    // tiene forma de tasación, se descarta antes de guardarlo/mandarlo y se
    // reemplaza por una respuesta segura, avisando al admin para que revise.
    if (contieneTasacionPropia(textoWA)) {
      console.error(
        `🚫 Bot intentó dar una tasación no autorizada en conv ${conversacion.id} — bloqueado. Texto original: ${textoWA.slice(0, 300)}`,
      );
      textoWA =
        "Para poder confirmarle el valor de su vehículo a entregar como parte de pago, lo mejor es que un asesor lo evalúe directamente. ¿Le parece que coordinemos una visita o que un asesor se comunique con usted?";
      try {
        const { notificarAdmin } = require("../services/notificacionAdmin");
        const nombre = conversacion.contactoNombre || conversacion.telefono;
        notificarAdmin(
          `🚫 El bot intentó dar una tasación no autorizada del vehículo a entregar en la conversación de ${nombre} — se bloqueó automáticamente. Revisá el chat.`,
        ).catch(() => {});
      } catch (_) {}
    }

    // Red de seguridad — mismo criterio que la tasación: el prompt prohíbe
    // confirmar descuentos o aceptar una contraoferta de precio, pero eso no
    // se puede garantizar al 100% en texto libre. Si el modelo terminó
    // "cerrando" un número por su cuenta, se descarta y se deriva a un asesor.
    if (contieneDescuentoNoAutorizado(textoWA)) {
      console.error(
        `🚫 Bot intentó confirmar un descuento/oferta no autorizada en conv ${conversacion.id} — bloqueado. Texto original: ${textoWA.slice(0, 300)}`,
      );
      textoWA =
        "Los descuentos y las condiciones finales de precio los confirma un asesor directamente. ¿Le parece que lo derive para que lo hablen?";
      try {
        const { notificarAdmin } = require("../services/notificacionAdmin");
        const nombre = conversacion.contactoNombre || conversacion.telefono;
        notificarAdmin(
          `🚫 El bot intentó confirmar un descuento u oferta de precio no autorizada en la conversación de ${nombre} — se bloqueó automáticamente. Revisá el chat.`,
        ).catch(() => {});
      } catch (_) {}
    }

    // Si el bot decidió cerrar/notificar (no derivar), la respuesta del cliente al
    // mensaje de seguimiento y la respuesta final del bot quedan ocultas para el
    // vendedor (el admin las sigue viendo siempre) — ver limpiarSeguimiento7Dias.js
    // y el filtro por rol en getConversaciones.js/getConversacionById.js.
    const ocultarSeguimiento = esperandoSeguimiento7Dias && conversacion._ocultarRespuestaSeguimiento === true;
    if (ocultarSeguimiento) {
      const mensajeOriginal = await Mensaje.findOne({
        where: { conversacionId: conversacion.id, esSeguimiento7Dias: true, autor: "bot" },
        order: [["timestamp", "DESC"]],
      });
      if (mensajeOriginal) {
        // La respuesta del cliente ya se emitió por socket sin la bandera (llegó
        // antes de que el bot termine de clasificarla) — al ocultarla ahora,
        // avisamos por socket para que cualquier vendedor con el chat abierto en
        // vivo la vea desaparecer, no solo en el próximo fetch.
        const mensajesAOcultar = await Mensaje.findAll({
          where: {
            conversacionId: conversacion.id,
            tipo: "entrante",
            timestamp: { [Op.gt]: mensajeOriginal.timestamp },
          },
        });
        if (mensajesAOcultar.length) {
          await Mensaje.update(
            { esSeguimiento7Dias: true },
            { where: { id: { [Op.in]: mensajesAOcultar.map(m => m.id) } } },
          );
          try {
            for (const m of mensajesAOcultar) {
              getIO().emit("conversacion:mensajeEliminado", {
                conversacionId: conversacion.id,
                mensajeId: m.id,
                campo: "esSeguimiento7Dias",
              });
            }
          } catch (_) {}
        }
      }
    }

    const mensajeBot = await Mensaje.create({
      conversacionId: conversacion.id,
      tipo: "saliente",
      autor: "bot",
      texto: textoWA,
      timestamp: new Date(),
      esSeguimiento7Dias: ocultarSeguimiento,
    });

    // Si el intercambio queda oculto para el vendedor (ocultarSeguimiento), no
    // adelantamos "último mensaje"/hora de actividad/no leídos — quedan
    // congelados en su último valor visible, igual que se hace en
    // webhookWhatsApp.js para la respuesta entrante del cliente. Si en cambio
    // el bot derivó a un asesor, sí queremos que se vea como actividad fresca.
    const debeActualizarActividadVisible = !ocultarSeguimiento;

    // La respuesta del propio bot NO es "actividad nueva sin ver" — el mensaje
    // del cliente que la disparó ya incrementó noLeido/adminNoLeido en
    // webhookWhatsApp.js. Volver a marcarlos acá hacía que CADA respuesta del
    // bot (incluso un Q&A de rutina que el bot resuelve solo, sin que haga
    // falta que un humano mire nada) inflara para siempre el badge de admin en
    // la sidebar, que solo se limpia si el admin abre esa conversación puntual
    // — con cientos de charlas que el bot resuelve solo, terminaba mostrando
    // un número muy por encima de lo que realmente necesita atención (ver
    // getSidebarBadges.js). Cuando SÍ hace falta avisarle al admin de algo
    // puntual (derivación a asesor, consulta nueva, etc.) ya existe un aviso
    // dedicado por notificarAdmin(), independiente de este flag.
    // Única excepción: el intercambio oculto de seguimiento de 7 días, que el
    // vendedor no puede ver — ahí sí forzamos adminNoLeido para que quede
    // alguna señal de que ese intercambio existe.
    try {
      getIO().emit("conversacion:mensaje", {
        conversacionId: conversacion.id,
        mensaje: {
          id: mensajeBot.id,
          tipo: "saliente",
          autor: "bot",
          texto: textoWA,
          timestamp: mensajeBot.timestamp,
          esSeguimiento7Dias: ocultarSeguimiento,
        },
        ultimoMensaje: debeActualizarActividadVisible ? textoWA : conversacion.ultimoMensaje,
        ultimaActividad: debeActualizarActividadVisible ? new Date() : conversacion.ultimaActividad,
        noLeido: conversacion.noLeido || 0,
        adminNoLeido: ocultarSeguimiento ? true : conversacion.adminNoLeido,
      });
    } catch (_) {} // si el socket no está disponible no rompe nada

    await conversacion.update(
      debeActualizarActividadVisible
        ? { ultimoMensaje: textoWA, ultimaActividad: new Date() }
        : { adminNoLeido: true },
      {
        fields: debeActualizarActividadVisible
          ? ["ultimoMensaje", "ultimaActividad"]
          : ["adminNoLeido"],
      },
    );

    // Solo apagamos la bandera si el modelo REALMENTE ejecutó una acción sobre la
    // visita (confirmarVisita/cancelarVisita/agendarVisita) en este turno. Antes se
    // apagaba sin condición, así que si el modelo solo respondía en texto ("voy a
    // cancelar... un momento") sin llamar ninguna tool, la visita quedaba sin
    // cancelar/reprogramar Y el flujo especial de reagendado se perdía para el
    // siguiente mensaje del cliente (quedaba huérfano, sin la bandera que lo activa).
    const accionReagendoEjecutada = nombresToolsLlamadas.some(n =>
      ["confirmarVisita", "cancelarVisita", "agendarVisita"].includes(n),
    );
    if (esperandoConfirmacion && eventoHoy && accionReagendoEjecutada) {
      await eventoHoy.update({ esperandoConfirmacion: false });
    }

    return textoWA;
  } catch (err) {
    console.error("Error en procesarMensaje:", err);

    const fallback = "Perdoná, tuve un problema técnico. Un asesor te va a contactar enseguida.";

    await Mensaje.create({
      conversacionId,
      tipo: "saliente",
      autor: "bot",
      texto: fallback,
      timestamp: new Date(),
    });

    let noLeidoFallback = null;
    let actualizacionOk = false;
    try {
      const convActual = await Conversacion.findByPk(conversacionId);
      if (convActual) {
        noLeidoFallback = (convActual.noLeido || 0) + 1;
        await convActual.update({
          ultimoMensaje: fallback,
          ultimaActividad: new Date(),
          noLeido: noLeidoFallback,
          adminNoLeido: true,
        });
        actualizacionOk = true;
      }
    } catch (e) {
      console.warn(`⚠️ No se pudo actualizar conv ${conversacionId} tras fallback:`, e.message);
    }

    try {
      getIO().emit("conversacion:mensaje", {
        conversacionId,
        mensaje: { tipo: "saliente", autor: "bot", texto: fallback, timestamp: new Date() },
        ultimoMensaje: fallback,
        ultimaActividad: new Date(),
        noLeido: noLeidoFallback,
        adminNoLeido: actualizacionOk,
      });
    } catch (_) {}

    return fallback;
  }
}

module.exports = procesarMensaje;
