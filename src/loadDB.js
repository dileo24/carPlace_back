const autos = require("./json/autos.json");
const categorias = require("./json/categorias.json");
const marcas = require("./json/marcas.json");
const { Auto, Categoria, Marca, Configuracion } = require("./db.js");
require("dotenv").config();

async function fnCategorias() {
  for (const categ of categorias) {
    await Categoria.findOrCreate({
      where: { categ: categ.categ },
      defaults: categ
    });
  }
}

// Marcas (con foto ya subida al Cloudinary de este proyecto) clonadas de
// sportquatro. Se insertan una sola vez: el marcador en Configuracion evita
// que una marca borrada desde el CRM reaparezca en el próximo arranque.
const SEED_MARCAS_CLAVE = "seed_marcas_sportquatro_v1";
async function fnMarcas() {
  const yaAplicado = await Configuracion.findOne({ where: { clave: SEED_MARCAS_CLAVE } });
  if (yaAplicado) return false;
  for (const marca of marcas) {
    await Marca.findOrCreate({ where: { nombre: marca.nombre }, defaults: marca });
  }
  await Configuracion.create({ clave: SEED_MARCAS_CLAVE, valor: { aplicadoEn: new Date().toISOString() } });
  return true;
}
async function fnAutos() {
  for (const auto of autos) {
    const newAuto = await Auto.create({
      marca: auto.marca,
      modelo: auto.modelo,
      motor: auto.motor,
      anio: auto.anio,
      km: auto.km,
      transmision: auto.transmision,
      combustible: auto.combustible,
      moneda: auto.moneda,
      precio: auto.precio,
      destacar: auto.destacar,
      oferta: auto.oferta,
      precio_oferta: auto.precio_oferta,
      img: auto.img,
    });

    const categorias = await Categoria.findAll({
      where: { id: auto.id_categ },
    });

    await newAuto.addCategorias(categorias);
  }
}

module.exports = {
  fnCategorias,
  fnMarcas,
  fnAutos,
};
