// controllers/autos/createAuto.js
const { Auto, Categoria, Tarea } = require("../../db");
const { parsearEnteroLimpio } = require("../../services/formatearAuto");

const CAMPOS_NUMERICOS = ["anio", "km", "precio", "precio_oferta", "precio_compra"];

/**
 * Al crear un auto genera automáticamente una tarea de tipo "comercial"
 * para recordar publicarlo en Instagram, Mercado Libre y Facebook.
 *
 * La fecha de vencimiento se fija a 2 días desde hoy (margen razonable
 * para tener fotos y descripción lista antes de publicar).
 */
const createAuto = async (req, res, next) => {
  try {
    const auto = req.body;

    // anio/km/precio/precio_oferta son columnas INT: el front todavía manda
    // estos campos como texto con puntos de miles (ej. "51.000.000").
    for (const campo of CAMPOS_NUMERICOS) {
      if (auto[campo] !== undefined) auto[campo] = parsearEnteroLimpio(auto[campo]);
    }

    const categorias = await Categoria.findAll({
      where: { id: auto.id_categ },
    });

    // Posición fija en el orden "aleatorio" del catálogo público — se asigna
    // una única vez acá y nunca se vuelve a tocar (ver allAutos.js).
    auto.orden_aleatorio = Math.random();

    const newAuto = await Auto.create(auto);

    if (categorias.length > 0) {
      await newAuto.setCategorias(categorias);
    }
    
    res.status(200).json({
      status: "200",
      resp: `El auto ${newAuto.modelo} se ha creado exitosamente.`,
      id: newAuto.id,
    });
  } catch (err) {
    res.status(404).json({ status: "404", resp: err.message });
  }
};

module.exports = createAuto;
