const { User } = require("../db");

async function obtenerTodosLosUsuarioIds() {
  const usuarios = await User.findAll({ attributes: ["id"] });
  return usuarios.map((u) => u.id);
}

module.exports = { obtenerTodosLosUsuarioIds };