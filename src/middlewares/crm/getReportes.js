// middlewares/crm/getReportes.js
const { Consulta, Venta, Tarea, Auto, Conversacion } = require("../../db");
const { Op } = require("sequelize");

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

function startOfMonth(year, month) {
  return new Date(year, month, 1);
}

const getReportes = async (req, res) => {
  try {
    const now = new Date();
    const anioActual = now.getFullYear();
    const mesActual = now.getMonth(); // 0-indexed
    const rol = req.user?.rol || "";
    const userId = req.user?.id ?? null;

    // ── Traer datos base ──────────────────────────────────────────────────────
    const [todasConsultas, todasVentasSinFiltrar, todasTareasSinFiltrar, todosAutosSinFiltrar, todasConversaciones] =
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
        Tarea.findAll(),
        Auto.findAll({
          attributes: [
            "id",
            "marca",
            "modelo",
            "anio",
            "precio",
            "fecha_recepcion",
            "estado",
            "tipo",
            "propietario",
          ],
        }),
        Conversacion.findAll({
          attributes: ["id", "estado", "canal", "createdAt"],
          order: [["createdAt", "ASC"]],
        }),
      ]);

    // ── Alcance por rol ────────────────────────────────────────────────────────
    // El socio solo puede ver sus propios autos/ventas (o los compartidos) y
    // sus propias tareas; el resto del equipo (cualquier rol que no sea admin
    // ni socio) directamente no ve nada del socio, ni siquiera agregado.
    const esDelSocio = propietario => propietario === "socio" || propietario === "compartido";
    let todosAutos = todosAutosSinFiltrar;
    let todasVentas = todasVentasSinFiltrar;
    let todasTareas = todasTareasSinFiltrar;

    if (rol === "socio") {
      todosAutos = todosAutosSinFiltrar.filter(a => esDelSocio(a.propietario));
      todasVentas = todasVentasSinFiltrar.filter(v => esDelSocio(v.propietarioAuto));
      todasTareas = todasTareasSinFiltrar.filter(t => t.creadoPorId === userId);
    } else if (rol !== "admin") {
      todosAutos = todosAutosSinFiltrar.filter(a => !esDelSocio(a.propietario));
      todasVentas = todasVentasSinFiltrar.filter(v => !esDelSocio(v.propietarioAuto));
    }

    // Peso de cada auto/venta compartida al 50% (solo desde la óptica del
    // socio — la agencia/admin ve el valor total del negocio sin prorratear).
    const pesoAuto = a => (rol === "socio" && a.propietario === "compartido" ? 0.5 : 1);
    const pesoVenta = v => (rol === "socio" && v.propietarioAuto === "compartido" ? 0.5 : 1);

    // Filtrar ventas con fecha válida (ignorar 1900)
    const ventasValidas = todasVentas.filter(v => {
      const f = new Date(v.fechaVenta);
      return f.getFullYear() > 1990;
    });

    // ── 1. EMBUDO DE CONVERSIÓN ───────────────────────────────────────────────
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

    // ── 2. VENTAS POR MES (año actual) ────────────────────────────────────────
    const ventasPorMesAnioActual = [];
    for (let m = 0; m <= mesActual; m++) {
      const inicio = startOfMonth(anioActual, m);
      const fin = startOfMonth(anioActual, m + 1);
      const count = ventasValidas.filter(v => {
        const f = new Date(v.fechaVenta);
        return f >= inicio && f < fin;
      }).length;
      ventasPorMesAnioActual.push({
        mes: MESES_LABELS[m],
        mesNum: m + 1,
        anio: anioActual,
        unidades: count,
      });
    }

    const mesActualData = ventasPorMesAnioActual[ventasPorMesAnioActual.length - 1];
    const mesAnteriorData = ventasPorMesAnioActual[ventasPorMesAnioActual.length - 2] ?? {
      unidades: 0,
    };
    const diasEnMes = new Date(anioActual, mesActual + 1, 0).getDate();
    const diaActual = now.getDate();
    const proyeccion =
      diaActual > 0 ? Math.round((mesActualData.unidades / diaActual) * diasEnMes) : 0;

    // ── 3. VENTAS HISTÓRICAS (años anteriores) ────────────────────────────────
    const aniosDisponibles = [2023, 2024, 2025, anioActual];
    const patrimonioHistorico = {};

    for (const anio of aniosDisponibles) {
      const mesesDelAnio = anio === anioActual ? mesActual + 1 : 12;
      const ventasMensuales = [];
      for (let m = 0; m < mesesDelAnio; m++) {
        const inicio = startOfMonth(anio, m);
        const fin = startOfMonth(anio, m + 1);
        const count = ventasValidas.filter(v => {
          const f = new Date(v.fechaVenta);
          return f >= inicio && f < fin;
        }).length;
        ventasMensuales.push({ mes: MESES_LABELS[m], vendidos: count });
      }
      patrimonioHistorico[anio] = { ventasMensuales };
    }

    // Stock actual para patrimonio (año actual)
    const parsePrecio = str => {
      if (!str) return 0;
      return parseInt(String(str).replace(/\./g, "").replace(/,/g, ""), 10) || 0;
    };

    const autosActivos = todosAutos;
    const totalUnidades = autosActivos.length;
    const totalBruto = autosActivos.reduce((s, a) => s + parsePrecio(a.precio) * pesoAuto(a), 0);
    const unidadesPatrimonio = autosActivos.filter(a => a.tipo === "patrimonio").length;
    const unidadesConsignacion = autosActivos.filter(
      a => a.tipo === "consignacion" || a.tipo === "consignacion_online",
    ).length;
    const unidadesGeneral = totalUnidades - unidadesPatrimonio - unidadesConsignacion;
    const valorPatrimonio = Math.round(
      autosActivos
        .filter(a => a.tipo === "patrimonio")
        .reduce((s, a) => s + parsePrecio(a.precio) * pesoAuto(a), 0) / 1_000_000,
    );
    const valorConsignacion = Math.round(
      autosActivos
        .filter(a => a.tipo === "consignacion" || a.tipo === "consignacion_online")
        .reduce((s, a) => s + parsePrecio(a.precio) * pesoAuto(a), 0) / 1_000_000,
    );
    const valorGeneral = Math.round(
      autosActivos.filter(a => !a.tipo).reduce((s, a) => s + parsePrecio(a.precio) * pesoAuto(a), 0) / 1_000_000,
    );

    patrimonioHistorico[anioActual].stockActual = {
      patrimonio: { unidades: unidadesPatrimonio, valorM: valorPatrimonio },
      consignacion: { unidades: unidadesConsignacion, valorM: valorConsignacion },
      sinClasificar: { unidades: unidadesGeneral, valorM: valorGeneral },
    };

    // ── 3b. GANANCIA ──────────────────────────────────────────────────────────
    // Solo existe para ventas con precio de compra cargado (venta.ganancia no
    // es null) — autos de consignación u otros sin precio de compra no suman acá.
    const ventasConGanancia = ventasValidas.filter(v => v.ganancia != null);
    const gananciaTotal = Math.round(
      ventasConGanancia.reduce((s, v) => s + v.ganancia * pesoVenta(v), 0),
    );
    const gananciaPorMes = [];
    for (let i = 5; i >= 0; i--) {
      const fecha = new Date(anioActual, mesActual - i, 1);
      const inicio = startOfMonth(fecha.getFullYear(), fecha.getMonth());
      const fin = startOfMonth(fecha.getFullYear(), fecha.getMonth() + 1);
      const ventasMes = ventasConGanancia.filter(v => {
        const f = new Date(v.fechaVenta);
        return f >= inicio && f < fin;
      });
      gananciaPorMes.push({
        mes: MESES_LABELS[fecha.getMonth()],
        total: Math.round(ventasMes.reduce((s, v) => s + v.ganancia * pesoVenta(v), 0)),
      });
    }

    // ── 4. PERFORMANCE POR ASESOR ─────────────────────────────────────────────
    // Agrupar consultas por asesor
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

    // Intentar cruzar con ventas por nombre de asesor (aproximación)
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
    // Por mes (últimos 6 meses)
    const origenPorMes = [];
    for (let i = 5; i >= 0; i--) {
      const fecha = new Date(anioActual, mesActual - i, 1);
      const inicio = startOfMonth(fecha.getFullYear(), fecha.getMonth());
      const fin = startOfMonth(fecha.getFullYear(), fecha.getMonth() + 1);
      const row = { mes: MESES_LABELS[fecha.getMonth()] };
      const consultasMes = todasConsultas.filter(c => {
        const f = new Date(c.createdAt);
        return f >= inicio && f < fin;
      });
      Object.keys(COLORES_ORIGEN).forEach(origen => {
        row[origen] = consultasMes.filter(c => c.origen === origen).length;
      });
      origenPorMes.push(row);
    }

    // Conversión por canal
    const conversionPorCanal = Object.entries(COLORES_ORIGEN)
      .map(([canal, color]) => {
        const total = todasConsultas.filter(c => c.origen === canal).length;
        const cerrad = todasConsultas.filter(
          c => c.origen === canal && c.estado === "cerrado",
        ).length;
        return { canal, tasa: pct(total, cerrad), color: CONVERSION_COLORS[canal] || color };
      })
      .filter(c => {
        const total = todasConsultas.filter(x => x.origen === c.canal).length;
        return total > 0;
      })
      .sort((a, b) => b.tasa - a.tasa);

    // ── 6. STOCK E INVENTARIO ─────────────────────────────────────────────────
    // Stock items — usar fecha_recepcion en vez de createdAt
    const stockItems = autosActivos
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
      disp: autosActivos.filter(a => a.estado === "disponible").length,
      sen: autosActivos.filter(a => a.estado === "senado").length,
      criticos: stockItems.filter(s => s.critico).length,
      promDias: stockItems.length
        ? Math.round(stockItems.reduce((s, a) => s + a.dias, 0) / stockItems.length)
        : 0,
    };

    // ── 7. TOMA DE USADOS ─────────────────────────────────────────────────────
    const ventasConUsado = ventasValidas.filter(v => v.autoRecibido && v.recibioPago);
    const totalVentasValidas = ventasValidas.length;

    // Extraer marca del string de autoRecibido (primera palabra capitalizada)
    function extraerMarca(str) {
      if (!str) return "Otro";
      const palabra = str.trim().split(/\s+/)[0];
      return palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase();
    }

    const marcasCount = {};
    ventasConUsado.forEach(v => {
      const marca = extraerMarca(v.autoRecibido);
      marcasCount[marca] = (marcasCount[marca] || 0) + 1;
    });

    const usadosPorMarca = Object.entries(marcasCount)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // Por mes (últimos 6 meses)
    const usadosPorMes = [];
    for (let i = 5; i >= 0; i--) {
      const fecha = new Date(anioActual, mesActual - i, 1);
      const inicio = startOfMonth(fecha.getFullYear(), fecha.getMonth());
      const fin = startOfMonth(fecha.getFullYear(), fecha.getMonth() + 1);
      const count = ventasConUsado.filter(v => {
        const f = new Date(v.fechaVenta);
        return f >= inicio && f < fin;
      }).length;
      usadosPorMes.push({ mes: MESES_LABELS[fecha.getMonth()], cantidad: count });
    }

    // ── 8. TAREAS ─────────────────────────────────────────────────────────────
    const tareasVivas = todasTareas.filter(t => t.estado !== "cancelada");
    const completadas = tareasVivas.filter(t => t.estado === "completada").length;
    const pendientes = tareasVivas.filter(t => t.estado === "pendiente").length;
    const enProgreso = tareasVivas.filter(t => t.estado === "en_progreso").length;

    // Por asesor — las tareas no tienen asesorId, agrupamos por creadoPor
    // Como no hay nombre de asesor en tareas, devolvemos resumen global
    const tareasPorAsesor = [{ nombre: "Equipo", completadas, pendientes, vencidas: 0 }];

    // ── 9. BOT ────────────────────────────────────────────────────────────────
    const botPorMes = [];
    for (let i = 5; i >= 0; i--) {
      const fecha = new Date(anioActual, mesActual - i, 1);
      const inicio = startOfMonth(fecha.getFullYear(), fecha.getMonth());
      const fin = startOfMonth(fecha.getFullYear(), fecha.getMonth() + 1);
      const convsMes = todasConversaciones.filter(c => {
        const f = new Date(c.createdAt);
        return f >= inicio && f < fin;
      });
      const iniciadas = convsMes.length;
      const derivadas = convsMes.filter(
        c => c.estado === "asesor" || c.estado === "cerrada",
      ).length;
      const abandonadas = iniciadas - derivadas;
      botPorMes.push({
        mes: MESES_LABELS[fecha.getMonth()],
        iniciadas,
        derivadas,
        abandonadas: Math.max(0, abandonadas),
        tiempoDerivacionHs: 0,
      });
    }

    const botActual = botPorMes[botPorMes.length - 1];

    const respuesta = {
      // 1. Embudo
      embudoEtapas,
      tiempoPorEtapa,

      // 2. Ventas
      ventasHistoricas: ventasPorMesAnioActual,
      proyeccionMesActual: proyeccion,
      mesActual: mesActualData,
      mesAnterior: mesAnteriorData,

      // 3. Patrimonio histórico
      patrimonioHistorico,

      // 3b. Ganancia
      gananciaTotal,
      gananciaPorMes,

      // 4. Performance asesor
      ventasPorAsesor,

      // 5. Origen
      origenPorMes,
      conversionPorCanal,

      // 6. Stock
      stockItems,
      stockResumen,

      // 7. Usados
      ventasConUsadoCount: ventasConUsado.length,
      totalVentasValidas,
      usadosPorMarca,
      usadosPorMes,

      // 8. Tareas
      tareas: { total: tareasVivas.length, completadas, pendientes, enProgreso },
      tareasPorAsesor,

      // 9. Bot
      botMetricasHistorico: botPorMes,
      botActual,
    };

    // El socio no tiene acceso a Consultas/Conversaciones ni a datos de todo
    // el equipo — se le sacan las secciones que dependen de eso.
    if (rol === "socio") {
      delete respuesta.embudoEtapas;
      delete respuesta.tiempoPorEtapa;
      delete respuesta.ventasPorAsesor;
      delete respuesta.origenPorMes;
      delete respuesta.conversionPorCanal;
      delete respuesta.botMetricasHistorico;
      delete respuesta.botActual;
    }

    return res.status(200).json({ status: 200, resp: respuesta });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = getReportes;
