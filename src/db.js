require("dotenv").config();
const { Sequelize } = require("sequelize");
const fs = require("fs");
const path = require("path");
const { DB_USER, DB_PASSWORD, DB_HOST, DB_NAME, DB_PORT } = process.env;

const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  dialect: "mysql",
  logging: false,
  define: {
    timestamps: false,
  },
});

const basename = path.basename(__filename);

fs.readdirSync(path.join(__dirname, "/models"))
  .filter(file => file.indexOf(".") !== 0 && file !== basename && file.slice(-3) === ".js")
  .forEach(file => {
    const mod = require(path.join(__dirname, "/models", file));
    if (typeof mod !== "function") {
      console.error("❌ MODELO ROTO:", file);
    } else {
      mod(sequelize);
    }
  });

const entries = Object.entries(sequelize.models);
const capsEntries = entries.map(entry => [entry[0][0].toUpperCase() + entry[0].slice(1), entry[1]]);
sequelize.models = Object.fromEntries(capsEntries);

const {
  Auto,
  User,
  Tarea,
  Configuracion,
  AutoTareaAlistaje,
  Venta,
  Categoria,
  EventoCalendario,
  Consulta,
  Conversacion,
  Mensaje,
  ConsultaHistorial,
  Publicacion,
} = sequelize.models;

// ── Autos ↔ Categorías ───────────────────────────────────────────────────────
Categoria.belongsToMany(Auto, {
  through: "Auto_Categoria",
  foreignKey: "categoriaId",
  as: "autos",
});

Auto.belongsToMany(Categoria, {
  through: "Auto_Categoria",
  foreignKey: "autoId",
  as: "categorias",
});

// ── Consulta ↔ Eventos del calendario ────────────────────────────────────────
Consulta.hasMany(EventoCalendario, {
  foreignKey: "consultaId",
  as: "eventos",
});

EventoCalendario.belongsTo(Consulta, {
  foreignKey: "consultaId",
  as: "consulta",
});

// ── Autos ↔ Publicaciones externas ───────────────────────────────────────────
// SET NULL (no CASCADE): si se borra el auto pero la publicación no se pudo
// eliminar en MercadoLibre (ver deleteAuto.js), la fila de Publicacion tiene
// que sobrevivir igual — perderla en cascada dejaba publicaciones huérfanas
// y vivas en ML sin ningún rastro en el CRM para poder gestionarlas después.
Auto.hasMany(Publicacion, {
  foreignKey: "autoId",
  as: "publicaciones",
  onDelete: "SET NULL",
});

Publicacion.belongsTo(Auto, {
  foreignKey: "autoId",
});

// ── Autos ↔ Tareas de alistaje ────────────────────────────────────────────────
Auto.hasMany(AutoTareaAlistaje, {
  foreignKey: "autoId",
  as: "tareasAlistaje",
  onDelete: "CASCADE",
});

AutoTareaAlistaje.belongsTo(Auto, {
  foreignKey: "autoId",
});

// ── Consulta ↔ ConsultaHistorial ─────────────────────────────────────────────
Consulta.hasMany(ConsultaHistorial, {
  foreignKey: "consultaId",
  as: "historial",
});
ConsultaHistorial.belongsTo(Consulta, { foreignKey: "consultaId" });

// ── Conversacion ↔ ConsultaHistorial (notas cargadas desde el perfil) ───────
Conversacion.hasMany(ConsultaHistorial, {
  foreignKey: "conversacionId",
  as: "notas",
});
ConsultaHistorial.belongsTo(Conversacion, { foreignKey: "conversacionId" });

// En donde definís las asociaciones de Sequelize
Conversacion.hasMany(Mensaje, { foreignKey: "conversacionId", as: "mensajes" });
Mensaje.belongsTo(Conversacion, { foreignKey: "conversacionId" });

Conversacion.belongsTo(Consulta, { foreignKey: "consultaId", as: "consulta" });
Consulta.hasOne(Conversacion, { foreignKey: "consultaId", as: "conversacion" });

Mensaje.belongsTo(User, { foreignKey: "userId", as: "autorUsuario" });
Conversacion.belongsTo(User, { foreignKey: "asesorId", as: "asesorAsignado" });

module.exports = {
  ...sequelize.models,
  conn: sequelize,
};
