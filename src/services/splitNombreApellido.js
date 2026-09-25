// Separa un nombre completo en nombre/apellido cuando el apellido viene vacío.
// Si ya viene separado (apellido con contenido), no toca nada — respeta lo que
// ya esté bien dividido, sea por un humano o por el bot en un caso correcto.
function splitNombreApellido(nombreRaw, apellidoRaw) {
  const nombre = (nombreRaw || "").trim();
  const apellido = (apellidoRaw || "").trim();

  if (apellido) return { nombre, apellido };

  const partes = nombre.split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return { nombre, apellido: "" };

  return {
    nombre: partes[0],
    apellido: partes.slice(1).join(" "),
  };
}

module.exports = splitNombreApellido;