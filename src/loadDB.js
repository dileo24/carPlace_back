const autos = require("./json/autos.json");
const categorias = require("./json/categorias.json");
const { encrypt } = require("./helpers/handleCrypt");
const { Admin, Auto, Categoria } = require("./db.js");
require("dotenv").config();

async function fnCategorias() {
  for (const categ of categorias) {
    await Categoria.findOrCreate({
      where: { categ: categ.categ },
      defaults: categ
    });
  }
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

async function fnAdmin() {
  const admin = await Admin.create({
    email: process.env.ADMIN_EMAIL,
    pass: await encrypt(process.env.ADMIN_PASS),
  });
}

module.exports = {
  fnCategorias,
  fnAutos,
  fnAdmin,
};
