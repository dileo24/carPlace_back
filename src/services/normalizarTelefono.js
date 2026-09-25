const normalizarTelefono = telefono => {
  if (!telefono) return null;
  let t = telefono.replace(/\D/g, ""); // sacar espacios, guiones, etc.

  // Sacar el prefijo de país si ya viene puesto, para trabajar siempre
  // sobre el núcleo del número (código de área + número).
  if (t.startsWith("549")) {
    t = t.slice(3);
  } else if (t.startsWith("54")) {
    t = t.slice(2);
  }

  // El "0" que se antepone al código de área al anotarlo localmente
  // (ej: "0351...") nunca es parte del número real — se descarta siempre,
  // esté donde esté (con o sin prefijo de país antes).
  if (t.startsWith("0")) {
    t = t.slice(1);
  }

  if (t.length === 7 || t.length === 8) return null; // demasiado corto para ser válido

  return "549" + t;
};

module.exports = normalizarTelefono;
