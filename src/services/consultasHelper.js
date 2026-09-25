const { Consulta } = require("../db");
const { Op } = require("sequelize");

const ESTADOS_ACTIVOS = ["nuevo", "con_oferta", "seguimiento"];

// Genera todas las variantes de formato de un teléfono para poder
// matchear sin importar cómo se haya guardado (con/sin 549, con/sin 54)
function variantesTelefono(telefono) {
  const limpio = (telefono || "").replace(/\D/g, "");
  if (!limpio) return [];
  const sin549 = limpio.replace(/^549/, "");
  const sin54 = limpio.replace(/^54/, "");
  const con549 = "549" + sin549;
  const con54 = "54" + sin549;
  return [...new Set([limpio, sin549, sin54, con549, con54])];
}

// Busca una consulta activa (nuevo/con_oferta/seguimiento) para un teléfono dado.
// excludeId sirve para no contarse a sí misma en updates.
async function buscarConsultaActiva(telefono, { excludeId } = {}) {
  const variantes = variantesTelefono(telefono);
  if (!variantes.length) return null;

  return Consulta.findOne({
    where: {
      telefono: { [Op.in]: variantes },
      estado: { [Op.in]: ESTADOS_ACTIVOS },
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
    },
  });
}

module.exports = { ESTADOS_ACTIVOS, variantesTelefono, buscarConsultaActiva };