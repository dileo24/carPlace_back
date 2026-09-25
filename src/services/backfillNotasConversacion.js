const { ConsultaHistorial } = require("../db");

// Cuando una conversación se vincula con una consulta (nueva o existente), las
// notas que se hayan cargado antes desde un solo lado (perfil de la
// conversación o historial de la consulta) quedan sueltas — esto completa la
// FK que les falta para que se vean desde ambos lados a partir de ese momento.
async function backfillNotasConversacion(conversacionId, consultaId) {
  if (!conversacionId || !consultaId) return;
  await ConsultaHistorial.update(
    { consultaId },
    { where: { conversacionId, consultaId: null } },
  );
  await ConsultaHistorial.update(
    { conversacionId },
    { where: { consultaId, conversacionId: null } },
  );
}

module.exports = { backfillNotasConversacion };
