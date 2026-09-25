// controllers/autos/allAutos.js
const { Auto, Categoria, AutoTareaAlistaje } = require("../../db");
const { Op } = require("sequelize");
const { getDolarBlue } = require("../../services/dolarBlue");
const { formatearAutoParaRespuesta } = require("../../services/formatearAuto");

const parsearNumero = str => parseInt(String(str).replace(/\./g, ""), 10) || 0;

const ROLES_VEN_NO_DISP = ["admin", "supervisor"];

const allAutos = async (req, res, next) => {
  try {
    const {
      search,
      marca,
      categoria,
      anioDesde,
      anioHasta,
      transmision,
      combustible,
      color,
      oferta,
      oferta_reventa,
    } = req.query;
    const { orderBy = "id", orderDir = "DESC" } = req.query;

    const COLUMNAS_PERMITIDAS = ["id", "marca", "modelo", "anio", "precio", "km", "orden_aleatorio"];
    const DIRS_PERMITIDAS = ["ASC", "DESC"];
    const columna = COLUMNAS_PERMITIDAS.includes(orderBy) ? orderBy : "id";
    const direccion = DIRS_PERMITIDAS.includes(orderDir.toUpperCase())
      ? orderDir.toUpperCase()
      : "DESC";

    const whereAuto = {};

    if (marca) whereAuto.marca = marca;
    // combustible y transmisión ahora pueden guardar más de un valor juntos
    // (ej. "Nafta/GNC", "Manual + Automática"), así que el filtro busca esa
    // opción como parte del valor, no exacta.
    if (transmision) whereAuto.transmision = { [Op.like]: `%${transmision}%` };
    if (combustible) whereAuto.combustible = { [Op.like]: `%${combustible}%` };
    // Un auto "a pedido" no tiene un color definido todavía — el cliente lo
    // pide a fábrica con el color que quiera, así que tiene que aparecer sin
    // importar qué color puntual se esté filtrando.
    if (color) whereAuto.color = { [Op.in]: [color, "a_pedido"] };

    if (oferta !== undefined && oferta !== "") whereAuto.oferta = oferta === "true";
    if (oferta_reventa !== undefined && oferta_reventa !== "")
      whereAuto.oferta_reventa = oferta_reventa === "true";

    // ── Visibilidad pública ──────────────────────────────
    // Sin sesión (visitante público): siempre se filtra oculto/no_disponible,
    // sin depender de que la pantalla que llama se acuerde de mandar
    // ?visible=true (así no vuelve a pasar que una pantalla pública nueva se
    // olvide del filtro, como pasó con Reventas.jsx).
    const rol = req.user?.rol || "";
    if (!req.user) {
      whereAuto.visible = true;
      whereAuto.estado = { [Op.ne]: "no_disponible" };
    } else {
      if (req.query.visible === "true") whereAuto.visible = true;
      // El rol solo puede venir del JWT verificado (req.user), nunca de un query param del cliente.
      if (!ROLES_VEN_NO_DISP.includes(rol)) {
        whereAuto.estado = { [Op.ne]: "no_disponible" };
      }
      // El socio solo ve sus propios autos (o los compartidos), nunca el
      // stock completo de la agencia.
      if (rol === "socio") {
        whereAuto.propietario = { [Op.in]: ["socio", "compartido"] };
      }
    }

    if (req.query.condicion === "nuevo") whereAuto.km = "0";
    else if (req.query.condicion === "usado") whereAuto.km = { [Op.ne]: "0" };

    if (req.query.tipo) whereAuto.tipo = req.query.tipo;

    // Igual criterio: tracción también puede guardar más de un valor combinado.
    if (req.query.traccion) whereAuto.traccion = { [Op.like]: `%${req.query.traccion}%` };

    if (req.query.en_alistaje !== undefined && req.query.en_alistaje !== "")
      whereAuto.en_alistaje = req.query.en_alistaje === "true";

    if (search) {
      whereAuto[Op.or] = [
        { marca: { [Op.like]: `%${search}%` } },
        { modelo: { [Op.like]: `%${search}%` } },
      ];
    }

    const includeCategoria = {
      model: Categoria,
      as: "categorias",
      through: { attributes: [] },
    };
    if (categoria) {
      includeCategoria.where = { categ: categoria };
      includeCategoria.required = true;
    }

    let autos = await Auto.findAll({
      where: whereAuto,
      include: [includeCategoria, { model: AutoTareaAlistaje, as: "tareasAlistaje" }],
      order: [[columna, direccion]],
    });
    const dolarBlue = (await getDolarBlue()) || null;

    // Post-filtrado de rangos (strings con puntos)
    autos = autos.filter(auto => {
      const anio = parseInt(auto.anio, 10);
      const km = parsearNumero(auto.km);
      const precioOriginal = auto.oferta ? auto.precio_oferta : auto.precio;
      // Un auto sin precio cargado ("Consultar precio") queda exento del
      // filtro de precio — no es que valga $0, es que no se sabe. Mismo
      // criterio que ya se usa para USD sin cotización del dólar (más abajo).
      const sinPrecio = precioOriginal === null || precioOriginal === undefined || precioOriginal === "";
      const precioRaw = sinPrecio ? null : parsearNumero(precioOriginal);
      const esUSD = auto.moneda === "USD" || auto.moneda === "U$D";
      const precioEnARS = sinPrecio ? null : esUSD ? (dolarBlue ? precioRaw * dolarBlue : null) : precioRaw;

      // Si es USD y no hay dólar blue, o si no hay precio cargado, no
      // filtrar por precio (mostrar igual)
      const precio = precioEnARS;

      if (req.query.precioDesde && precio !== null && precio < parseInt(req.query.precioDesde, 10))
        return false;
      if (req.query.precioHasta && precio !== null && precio > parseInt(req.query.precioHasta, 10))
        return false;

      if (anioDesde && anio < parseInt(anioDesde, 10)) return false;
      if (anioHasta && anio > parseInt(anioHasta, 10)) return false;
      if (req.query.kmDesde && km < parseInt(req.query.kmDesde, 10)) return false;
      if (req.query.kmHasta && km > parseInt(req.query.kmHasta, 10)) return false;
      return true;
    });

    const resultado = autos.map(auto => formatearAutoParaRespuesta(auto, { publico: !req.user }));

    res.status(200).json({ status: 200, resp: resultado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = allAutos;
