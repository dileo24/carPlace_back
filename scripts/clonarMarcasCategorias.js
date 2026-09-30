// Clona Marcas y Categorías desde la base de sportquatro (solo lectura) hacia
// src/json/marcas.json y src/json/categorias.json, re-subiendo las fotos de
// las marcas al Cloudinary de este proyecto. El arranque del servidor
// (src/loadDB.js) es quien después inserta esos JSON en la base propia.
//
// Uso: node scripts/clonarMarcasCategorias.js <ruta a sportquatro_back/.env>
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
const cloudinary = require("cloudinary").v2;

const envPath = process.argv[2];
if (!envPath) {
  console.error("Falta la ruta al .env de sportquatro_back");
  process.exit(1);
}
const sq = dotenv.parse(fs.readFileSync(envPath));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const JSON_DIR = path.join(__dirname, "../src/json");

const subirFoto = async urlOrigen => {
  const { data } = await axios.get(urlOrigen, { responseType: "arraybuffer" });
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder: "general", format: "webp" }, (err, result) => (err ? reject(err) : resolve(result)))
      .end(Buffer.from(data));
  });
};

(async () => {
  const conn = await mysql.createConnection({
    host: sq.DB_HOST,
    port: sq.DB_PORT || 3306,
    user: sq.DB_USER,
    password: sq.DB_PASSWORD,
    database: sq.DB_NAME,
  });
  const [marcasSq] = await conn.query("SELECT nombre, fotoUrl FROM Marcas ORDER BY nombre");
  const [categSq] = await conn.query("SELECT categ FROM Categoria ORDER BY id");
  await conn.end();

  // Re-corridas: no vuelve a subir fotos de marcas que ya clonó antes.
  const marcasPath = path.join(JSON_DIR, "marcas.json");
  const previas = fs.existsSync(marcasPath) ? JSON.parse(fs.readFileSync(marcasPath, "utf8")) : [];
  const porNombre = new Map(previas.map(m => [m.nombre, m]));

  const marcas = [];
  for (const m of marcasSq) {
    const previa = porNombre.get(m.nombre);
    if (previa?.fotoUrl) {
      marcas.push(previa);
      continue;
    }
    let fotoUrl = null;
    let fotoPublicId = null;
    if (m.fotoUrl) {
      const r = await subirFoto(m.fotoUrl);
      fotoUrl = r.secure_url;
      fotoPublicId = r.public_id.split("/").pop();
    }
    console.log(`✔ ${m.nombre} ${fotoUrl ? "→ " + fotoUrl : "(sin foto)"}`);
    marcas.push({ nombre: m.nombre, fotoUrl, fotoPublicId });
  }
  fs.writeFileSync(marcasPath, JSON.stringify(marcas, null, 2) + "\n");

  const categPath = path.join(JSON_DIR, "categorias.json");
  const actuales = JSON.parse(fs.readFileSync(categPath, "utf8"));
  const nombres = new Set(actuales.map(c => c.categ));
  for (const c of categSq) if (!nombres.has(c.categ)) actuales.push({ categ: c.categ });
  fs.writeFileSync(categPath, JSON.stringify(actuales, null, 2) + "\n");

  console.log(`Marcas: ${marcas.length} · Categorías: ${actuales.length}`);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
