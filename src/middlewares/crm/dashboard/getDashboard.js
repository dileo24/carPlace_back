// middlewares/crm/getDashboard.js
const { Consulta, Venta, Tarea } = require("../../../db");
const { Op } = require("sequelize");

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

function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfWeek(d) {
  // lunes
  const r = new Date(d);
  const day = r.getDay() || 7;
  r.setDate(r.getDate() - day + 1);
  r.setHours(0, 0, 0, 0);
  return r;
}

const getDashboard = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    const userId = req.user?.id ?? null;
    const esAdmin = ["admin", "supervisor"].includes(rol);

    const now = new Date();
    const inicioMes = startOfMonth(now);
    const inicioMesAnterior = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const finMesAnterior = new Date(inicioMes.getTime() - 1);

    // ── Base where para consultas según rol ───────────────────────────────
    const whereBase = esAdmin ? {} : { asesorId: userId };

    // ── Todas las consultas del rol ───────────────────────────────────────
    const todasConsultas = await Consulta.findAll({
      where: whereBase,
      attributes: [
        "id",
        "estado",
        "origen",
        "createdAt",
        "nombre",
        "apellido",
        "vehiculo",
        "asesorNombre",
        "asesorApellido",
      ],
      order: [["createdAt", "DESC"]],
    });

    // ── Métricas del mes actual ───────────────────────────────────────────
    const consultasMesActual = todasConsultas.filter(c => new Date(c.createdAt) >= inicioMes);
    const consultasMesAnterior = todasConsultas.filter(c => {
      const f = new Date(c.createdAt);
      return f >= inicioMesAnterior && f <= finMesAnterior;
    });

    function countEstado(lista, estado) {
      return lista.filter(c => c.estado === estado).length;
    }

    function variacion(actual, anterior) {
      if (anterior === 0) return actual > 0 ? 100 : 0;
      return Math.round(((actual - anterior) / anterior) * 100);
    }

    const nuevasActual = consultasMesActual.length;
    const nuevasAnterior = consultasMesAnterior.length;
    const segActual = countEstado(consultasMesActual, "seguimiento");
    const segAnterior = countEstado(consultasMesAnterior, "seguimiento");
    const ofertaActual = countEstado(consultasMesActual, "con_oferta");
    const ofertaAnterior = countEstado(consultasMesAnterior, "con_oferta");

    // ── Ventas ────────────────────────────────────────────────────────────
    const todasVentas = esAdmin ? await Venta.findAll({ order: [["fechaVenta", "DESC"]] }) : [];

    const ventasMesActual = todasVentas.filter(v => new Date(v.fechaVenta) >= inicioMes);
    const ventasMesAnterior = todasVentas.filter(v => {
      const f = new Date(v.fechaVenta);
      return f >= inicioMesAnterior && f <= finMesAnterior;
    });

    const varVentas = variacion(ventasMesActual.length, ventasMesAnterior.length);

    // ── Métricas card ─────────────────────────────────────────────────────
    const metricas = {
      consultasNuevas: {
        valor: nuevasActual,
        variacion: Math.abs(variacion(nuevasActual, nuevasAnterior)),
        tendencia: nuevasActual >= nuevasAnterior ? "up" : "down",
      },
      enSeguimiento: {
        valor: segActual,
        variacion: Math.abs(variacion(segActual, segAnterior)),
        tendencia: segActual >= segAnterior ? "up" : "down",
      },
      conOferta: {
        valor: ofertaActual,
        variacion: Math.abs(variacion(ofertaActual, ofertaAnterior)),
        tendencia: ofertaActual >= ofertaAnterior ? "up" : "down",
      },
      ventasCerradas: {
        valor: ventasMesActual.length,
        variacion: Math.abs(varVentas),
        tendencia: ventasMesActual.length >= ventasMesAnterior.length ? "up" : "down",
      },
    };

    // ── Proceso de ventas (consultas activas agrupadas por estado) ────────
    const consultasActivas = todasConsultas.filter(c => !["cerrado", "perdido"].includes(c.estado));
    const procesoEstados = ["nuevo", "con_oferta", "seguimiento", "cerrado", "perdido"];
    const proceso = procesoEstados.map(estado => ({
      estado,
      consultas: consultasActivas
        .filter(c => c.estado === estado)
        .slice(0, 8)
        .map(c => ({
          id: c.id,
          nombre: c.nombre,
          apellido: c.apellido,
          vehiculo: c.vehiculo,
          asesorNombre: c.asesorNombre,
          asesorApellido: c.asesorApellido,
        })),
      total: consultasActivas.filter(c => c.estado === estado).length,
    }));

    // ── Origen de consultas (solo mes actual) ─────────────────────────────
    const origenCount = {};
    consultasMesActual.forEach(c => {
      origenCount[c.origen] = (origenCount[c.origen] || 0) + 1;
    });
    const totalOrigen = consultasMesActual.length || 1;
    const consultasPorOrigen = Object.entries(origenCount)
      .sort((a, b) => b[1] - a[1])
      .map(([origen, cantidad]) => ({
        origen,
        cantidad,
        porcentaje: Math.round((cantidad / totalOrigen) * 100),
        color: COLORES_ORIGEN[origen] || "#aaaaaa",
      }));

    // ── Consultas por semana (últimas 8 semanas) ──────────────────────────
    const semanas = [];
    for (let i = 7; i >= 0; i--) {
      const inicio = startOfWeek(new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000));
      const fin = new Date(inicio.getTime() + 7 * 24 * 60 * 60 * 1000);
      const count = todasConsultas.filter(c => {
        const f = new Date(c.createdAt);
        return f >= inicio && f < fin;
      }).length;
      semanas.push({
        dia: `${inicio.getDate()}/${inicio.getMonth() + 1}`,
        consultas: count,
      });
    }

    // ── Ventas por mes (últimos 6 meses) ──────────────────────────────────
    const MESES = [
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
    const ventasPorMes = [];
    for (let i = 5; i >= 0; i--) {
      const fecha = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const inicio = startOfMonth(fecha);
      const fin = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 1);
      const count = todasVentas.filter(v => {
        const f = new Date(v.fechaVenta);
        return f >= inicio && f < fin;
      }).length;
      ventasPorMes.push({
        semana: MESES[fecha.getMonth()],
        ventas: count,
      });
    }

    // ── Actividad reciente (últimas 6 consultas) ──────────────────────────
    function tiempoRelativo(fecha) {
      const diff = Math.floor((now - new Date(fecha)) / 1000);
      if (diff < 60) return "hace un momento";
      if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
      if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
      return `hace ${Math.floor(diff / 86400)} días`;
    }

    const actividadReciente = todasConsultas.slice(0, 6).map(c => ({
      id: c.id,
      tipo: "nueva_consulta",
      texto: c.nombre ? `${c.nombre} ${c.apellido ?? ""}`.trim() : "Nueva consulta",
      detalle: c.vehiculo || "—",
      tiempo: tiempoRelativo(c.createdAt),
    }));

    // ── Recordatorios: tareas pendientes (solo admin/supervisor) ─────────
    let recordatorios = [];
    if (esAdmin) {
      const tareas = await Tarea.findAll({
        where: { estado: { [Op.in]: ["pendiente", "en_progreso"] } },
        order: [["creadoEn", "ASC"]],
        limit: 10,
      });
      recordatorios = tareas.map(t => ({
        id: t.id,
        titulo: t.titulo,
        tipo: t.tipo,
        prioridad: t.prioridad,
        estado: t.estado,
        creadoEn: t.creadoEn,
      }));
    }

    // ── Tiempo de cierre promedio ─────────────────────────────────────────────
    let tiempoCierre = null;
    const consultasCerradas = todasConsultas.filter(
      c => c.estado === "cerrado" && c.estadoCambiadoEn && c.createdAt,
    );
    if (consultasCerradas.length > 0) {
      const dias = consultasCerradas.map(c =>
        Math.round((new Date(c.estadoCambiadoEn) - new Date(c.createdAt)) / (1000 * 60 * 60 * 24)),
      );
      const promedio = Math.round(dias.reduce((a, b) => a + b, 0) / dias.length);
      const meta = 14;
      tiempoCierre = {
        diasPromedio: promedio,
        meta,
        variacion: 0,
        contexto: `Promedio de ${consultasCerradas.length} consulta${consultasCerradas.length !== 1 ? "s" : ""} cerrada${consultasCerradas.length !== 1 ? "s" : ""}`,
      };
    }

    return res.status(200).json({
      status: 200,
      resp: {
        metricas,
        proceso,
        consultasPorOrigen,
        tiempoCierre,
        consultasPorSemana: semanas,
        ventasPorMes,
        actividadReciente,
        recordatorios,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = getDashboard;
