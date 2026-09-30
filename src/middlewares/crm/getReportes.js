// middlewares/crm/getReportes.js
const { Consulta, Venta, Auto, Conversacion } = require("../../db");

const MESES_LABELS = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];
const UMBRAL_SIN_MOVIMIENTO_DIAS = 180;

const COLORES_ORIGEN = {
  WhatsApp: "#25d366",
  Instagram: "#e1306c",
  Facebook: "#4267b2",
  Web: "#64b5f6",
  Teléfono: "#8bc34a",
  Presencial: "#ffc107",
  Referido: "#ce93d8",
  Otro: "#aaaaaa",
};

const CONVERSION_COLORS = {
  Referido: "#ffb74d",
  Presencial: "#a5d6a7",
  WhatsApp: "#25d366",
  Teléfono: "#90a4ae",
  Web: "#64b5f6",
  Instagram: "#e1306c",
  Facebook: "#1877f2",
  Otro: "#94a3b8",
};

function diasDesde(fecha) {
  const inicio = new Date(fecha);
  inicio.setHours(0, 0, 0, 0);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.floor((hoy - inicio) / 86400000);
}

function pct(de, a) {
  if (!de) return 0;
  return Math.round((a / de) * 100);
}

// ── Períodos (semana / mes) en hora Argentina (UTC-3, sin DST) ───────────────
// Se trabaja en "milisegundos AR": timestamp real - 3h, leído con getters UTC.
// fechaVenta es DATEONLY (YYYY-MM-DD): ya es una fecha de calendario, no se corre.
const AR_OFFSET_MS = 3 * 3600000;
const DIA_MS = 86400000;
const PERIODOS = ["semana", "mes"];
const SEMANAS_SERIE = 8;
const MESES_SERIE = 6;

const msAR = fecha => new Date(fecha).getTime() - AR_OFFSET_MS;
const msFechaVenta = fecha => new Date(fecha).getTime();

function ahoraAR() {
  return new Date(Date.now() - AR_OFFSET_MS);
}

function parsePeriodo(valor) {
  return PERIODOS.includes(valor) ? valor : "mes";
}

// Arma los buckets [inicio, fin) de la serie, del más viejo al más nuevo; el
// último es el período en curso. "ytd" (solo mes) arranca en enero del año actual.
function buildBuckets(periodo, { ytd = false } = {}) {
  const hoy = ahoraAR();
  const y = hoy.getUTCFullYear();
  const m = hoy.getUTCMonth();
  const d = hoy.getUTCDate();
  const buckets = [];
  if (periodo === "semana") {
    const lunes = d - ((hoy.getUTCDay() + 6) % 7);
    for (let i = SEMANAS_SERIE - 1; i >= 0; i--) {
      const inicio = Date.UTC(y, m, lunes - i * 7);
      const ini = new Date(inicio);
      buckets.push({
        label: `${ini.getUTCDate()}/${ini.getUTCMonth() + 1}`,
        inicio,
        fin: inicio + 7 * DIA_MS,
      });
    }
  } else {
    const cantidad = ytd ? m + 1 : MESES_SERIE;
    for (let i = cantidad - 1; i >= 0; i--) {
      const ini = new Date(Date.UTC(y, m - i, 1));
      buckets.push({
        label: MESES_LABELS[ini.getUTCMonth()],
        inicio: ini.getTime(),
        fin: Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + 1, 1),
      });
    }
  }
  return buckets;
}

// Elementos cuyo instante (ms AR, vía getMs) cae dentro del bucket.
const enBucket = (items, getMs, b) =>
  items.filter(it => {
    const t = getMs(it);
    return t >= b.inicio && t < b.fin;
  });

// Proyección lineal del período en curso: (acumulado / días transcurridos) * días totales.
function proyectar(periodo, unidades) {
  const hoy = ahoraAR();
  if (periodo === "semana") {
    const diaDeSemana = ((hoy.getUTCDay() + 6) % 7) + 1; // lunes = 1
    return Math.round((unidades / diaDeSemana) * 7);
  }
  const diasEnMes = new Date(
    Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return Math.round((unidades / hoy.getUTCDate()) * diasEnMes);
}

const getReportes = async (req, res) => {
  try {
    const periodo = parsePeriodo(req.query?.periodo);
    const rol = req.user?.rol || "";

    // ── Traer datos base ──────────────────────────────────────────────────────
    const [todasConsultas, todasVentasSinFiltrar, todosAutosSinFiltrar, todasConversaciones] =
      await Promise.all([
        Consulta.findAll({
          attributes: [
            "id",
            "estado",
            "origen",
            "asesorNombre",
            "asesorApellido",
            "asesorId",
            "createdAt",
            "estadoCambiadoEn",
          ],
          order: [["createdAt", "ASC"]],
        }),
        Venta.findAll({ order: [["fechaVenta", "DESC"]] }),
        Auto.findAll({
          attributes: ["id", "marca", "modelo", "anio", "fecha_recepcion", "estado", "propietario"],
        }),
        Conversacion.findAll({
          attributes: ["id", "estado", "canal", "createdAt"],
          order: [["createdAt", "ASC"]],
        }),
      ]);

    // ── Alcance por rol ────────────────────────────────────────────────────────
    // El socio solo puede ver sus propios autos/ventas (o los compartidos); el
    // resto del equipo (cualquier rol que no sea admin ni socio) directamente
    // no ve nada del socio, ni siquiera agregado.
    const esDelSocio = propietario => propietario === "socio" || propietario === "compartido";
    let todosAutos = todosAutosSinFiltrar;
    let todasVentas = todasVentasSinFiltrar;

    if (rol === "socio") {
      todosAutos = todosAutosSinFiltrar.filter(a => esDelSocio(a.propietario));
      todasVentas = todasVentasSinFiltrar.filter(v => esDelSocio(v.propietarioAuto));
    } else if (rol !== "admin") {
      todosAutos = todosAutosSinFiltrar.filter(a => !esDelSocio(a.propietario));
      todasVentas = todasVentasSinFiltrar.filter(v => !esDelSocio(v.propietarioAuto));
    }

    // Peso de cada venta compartida al 50% (solo desde la óptica del socio —
    // la agencia/admin ve el valor total del negocio sin prorratear).
    const pesoVenta = v => (rol === "socio" && v.propietarioAuto === "compartido" ? 0.5 : 1);

    // Filtrar ventas con fecha válida (ignorar 1900)
    const ventasValidas = todasVentas.filter(v => {
      const f = new Date(v.fechaVenta);
      return f.getFullYear() > 1990;
    });

    // ── 1. EMBUDO DE CONVERSIÓN (acumulado) ───────────────────────────────────
    const estadosEmbudo = ["nuevo", "con_oferta", "seguimiento", "cerrado", "perdido"];
    const coloresEmbudo = {
      nuevo: "#3b82f6",
      con_oferta: "#cc0000",
      seguimiento: "#8b5cf6",
      cerrado: "#22c55e",
      perdido: "#6b7280",
    };
    const labelsEmbudo = {
      nuevo: "Nuevo",
      con_oferta: "Con oferta",
      seguimiento: "Seguimiento",
      cerrado: "Cerrado",
      perdido: "Perdido",
    };

    // Contar consultas que en algún momento pasaron por cada estado
    // Como no tenemos historial, contamos las que están en cada estado + las que pasaron (cerradas)
    // Para "nuevo" contamos todas, para "cerrado" solo las cerradas, para el resto acumulativo
    const countPorEstado = {};
    estadosEmbudo.forEach(e => {
      countPorEstado[e] = 0;
    });
    todasConsultas.forEach(c => {
      const idx = estadosEmbudo.indexOf(c.estado);
      // Incrementar desde ese estado hacia atrás (todos los anteriores también la tuvieron)
      for (let i = 0; i <= idx; i++) {
        countPorEstado[estadosEmbudo[i]]++;
      }
    });

    const embudoEtapas = estadosEmbudo.map(e => ({
      key: e,
      label: labelsEmbudo[e],
      cantidad: countPorEstado[e],
      color: coloresEmbudo[e],
    }));

    // Tiempo por etapa: sin historial de cambios, usamos días promedio entre creación y estadoCambiadoEn
    // para las cerradas dividido por 4 etapas como aproximación
    const cerradas = todasConsultas.filter(
      c => c.estado === "cerrado" && c.estadoCambiadoEn && c.createdAt,
    );
    const diasTotalPromedio = cerradas.length
      ? cerradas.reduce(
          (s, c) =>
            s +
            Math.max(
              0,
              Math.round((new Date(c.estadoCambiadoEn) - new Date(c.createdAt)) / 86400000),
            ),
          0,
        ) / cerradas.length
      : 0;
    const diasPorEtapa = Math.round((diasTotalPromedio / 4) * 10) / 10;

    const tiempoPorEtapa = [
      { key: "nuevo", label: "Nuevo → Calificado", dias: diasPorEtapa },
      { key: "calificado", label: "Calificado → Oferta", dias: diasPorEtapa },
      { key: "con_oferta", label: "Oferta → Seguimiento", dias: diasPorEtapa },
      { key: "seguimiento", label: "Seguimiento → Cierre", dias: diasPorEtapa },
    ];

    // ── 2. VENTAS POR PERÍODO ─────────────────────────────────────────────────
    // Mes: año en curso (enero → hoy). Semana: últimas 8 semanas.
    const ventasHistoricas = buildBuckets(periodo, { ytd: true }).map(b => ({
      label: b.label,
      unidades: enBucket(ventasValidas, v => msFechaVenta(v.fechaVenta), b).length,
    }));
    const periodoActual = ventasHistoricas[ventasHistoricas.length - 1];
    const periodoAnterior = ventasHistoricas[ventasHistoricas.length - 2] ?? { unidades: 0 };
    const proyeccion = proyectar(periodo, periodoActual.unidades);

    // ── 3. GANANCIA ───────────────────────────────────────────────────────────
    // Solo existe para ventas con precio de compra cargado (venta.ganancia no
    // es null) — autos de consignación u otros sin precio de compra no suman acá.
    const ventasConGanancia = ventasValidas.filter(v => v.ganancia != null);
    const gananciaSerie = buildBuckets(periodo).map(b => ({
      label: b.label,
      total: Math.round(
        enBucket(ventasConGanancia, v => msFechaVenta(v.fechaVenta), b).reduce(
          (s, v) => s + v.ganancia * pesoVenta(v),
          0,
        ),
      ),
    }));
    const gananciaTotal = gananciaSerie.reduce((s, g) => s + g.total, 0);

    // ── 4. PERFORMANCE POR ASESOR (acumulado) ─────────────────────────────────
    const asesoresMap = {};
    todasConsultas.forEach(c => {
      if (!c.asesorNombre) return;
      const key = c.asesorNombre;
      if (!asesoresMap[key]) {
        asesoresMap[key] = {
          nombre: `${c.asesorNombre} ${c.asesorApellido ?? ""}`.trim(),
          consultasAsignadas: 0,
          ventasCerradas: 0,
        };
      }
      asesoresMap[key].consultasAsignadas++;
      if (c.estado === "cerrado") asesoresMap[key].ventasCerradas++;
    });

    // Las ventas no tienen asesorId, así que el conteo de ventasCerradas viene de consultas cerradas
    const ventasPorAsesor = Object.values(asesoresMap)
      .map((a, i) => ({
        asesorId: `a${i + 1}`,
        nombre: a.nombre,
        consultasAsignadas: a.consultasAsignadas,
        ventasCerradas: a.ventasCerradas,
        tiempoRespuestaPromHs: 0, // no disponible sin historial de mensajes
      }))
      .sort((a, b) => b.ventasCerradas - a.ventasCerradas);

    // ── 5. ORIGEN DE CONSULTAS ────────────────────────────────────────────────
    const origenSerie = buildBuckets(periodo).map(b => {
      const consultasPeriodo = enBucket(todasConsultas, c => msAR(c.createdAt), b);
      const row = { label: b.label };
      Object.keys(COLORES_ORIGEN).forEach(origen => {
        row[origen] = consultasPeriodo.filter(c => c.origen === origen).length;
      });
      return row;
    });

    // Conversión por canal (acumulado)
    const conversionPorCanal = Object.entries(COLORES_ORIGEN)
      .map(([canal, color]) => {
        const total = todasConsultas.filter(c => c.origen === canal).length;
        const cerrad = todasConsultas.filter(
          c => c.origen === canal && c.estado === "cerrado",
        ).length;
        return { canal, total, tasa: pct(total, cerrad), color: CONVERSION_COLORS[canal] || color };
      })
      .filter(c => c.total > 0)
      .map(({ canal, tasa, color }) => ({ canal, tasa, color }))
      .sort((a, b) => b.tasa - a.tasa);

    // ── 6. STOCK E INVENTARIO ─────────────────────────────────────────────────
    // Stock items — usar fecha_recepcion en vez de createdAt
    const stockItems = todosAutos
      .filter(a => a.estado !== "vendido" && a.estado !== "no_disponible")
      .map(a => ({
        marca: a.marca ? a.marca.charAt(0).toUpperCase() + a.marca.slice(1) : "—",
        modelo: a.modelo || "—",
        anio: a.anio,
        estado: a.estado || "disponible",
        dias: a.fecha_recepcion ? diasDesde(a.fecha_recepcion) : 0,
        critico: a.fecha_recepcion
          ? diasDesde(a.fecha_recepcion) >= UMBRAL_SIN_MOVIMIENTO_DIAS
          : false,
      }))
      .sort((a, b) => b.dias - a.dias)
      .slice(0, 20);
    const stockResumen = {
      disp: todosAutos.filter(a => a.estado === "disponible").length,
      sen: todosAutos.filter(a => a.estado === "senado").length,
      criticos: stockItems.filter(s => s.critico).length,
      promDias: stockItems.length
        ? Math.round(stockItems.reduce((s, a) => s + a.dias, 0) / stockItems.length)
        : 0,
    };

    // ── 7. TOMA DE USADOS ─────────────────────────────────────────────────────
    const ventasConUsado = ventasValidas.filter(v => v.autoRecibido && v.recibioPago);
    const totalVentasValidas = ventasValidas.length;
    const usadosSerie = buildBuckets(periodo).map(b => ({
      label: b.label,
      cantidad: enBucket(ventasConUsado, v => msFechaVenta(v.fechaVenta), b).length,
    }));

    // ── 8. BOT ────────────────────────────────────────────────────────────────
    const botSerie = buildBuckets(periodo).map(b => {
      const convsPeriodo = enBucket(todasConversaciones, c => msAR(c.createdAt), b);
      const iniciadas = convsPeriodo.length;
      const derivadas = convsPeriodo.filter(
        c => c.estado === "asesor" || c.estado === "cerrada",
      ).length;
      return {
        label: b.label,
        iniciadas,
        derivadas,
        abandonadas: Math.max(0, iniciadas - derivadas),
        tiempoDerivacionHs: 0,
      };
    });
    const botActual = botSerie[botSerie.length - 1];

    const respuesta = {
      periodo,

      // 1. Embudo (acumulado)
      embudoEtapas,
      tiempoPorEtapa,

      // 2. Ventas
      ventasHistoricas,
      proyeccion,
      periodoActual,
      periodoAnterior,

      // 3. Ganancia
      gananciaTotal,
      gananciaSerie,

      // 4. Performance asesor (acumulado)
      ventasPorAsesor,

      // 5. Origen
      origenSerie,
      conversionPorCanal,

      // 6. Stock (actual)
      stockItems,
      stockResumen,

      // 7. Usados
      ventasConUsadoCount: ventasConUsado.length,
      totalVentasValidas,
      usadosSerie,

      // 8. Bot
      botSerie,
      botActual,
    };

    // El socio no tiene acceso a Consultas/Conversaciones ni a datos de todo
    // el equipo — se le sacan las secciones que dependen de eso.
    if (rol === "socio") {
      delete respuesta.embudoEtapas;
      delete respuesta.tiempoPorEtapa;
      delete respuesta.ventasPorAsesor;
      delete respuesta.origenSerie;
      delete respuesta.conversionPorCanal;
      delete respuesta.botSerie;
      delete respuesta.botActual;
    }

    return res.status(200).json({ status: 200, resp: respuesta });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = getReportes;
