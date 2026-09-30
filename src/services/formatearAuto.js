// anio/km/precio/precio_oferta se guardan como INT en la base (migración
// jul/2026), pero el frontend siempre esperó/mostró estos campos como string
// con puntos de miles (ej. "51.000.000"). Estas funciones restauran ese
// formato en las respuestas de la API para no tener que tocar cada lugar del
// frontend que ya sabe mostrarlos/editarlos así.

const formatearMiles = valor => {
  if (valor === null || valor === undefined || valor === "") return valor;
  return String(valor).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

// { publico: true } oculta datos internos de compra/propietario que no tienen
// que llegar al catálogo público (mismo endpoint que usa el sitio web y el
// Stock del CRM — ver allAutos.js/getAutoByID.js).
const formatearAutoParaRespuesta = (autoInstance, { publico = false } = {}) => {
  const autoObj = typeof autoInstance.toJSON === "function" ? autoInstance.toJSON() : { ...autoInstance };

  if (autoObj.img && typeof autoObj.img === "string") {
    try {
      autoObj.img = JSON.parse(autoObj.img);
    } catch (_) {
      autoObj.img = [];
    }
  }

  if (autoObj.anio !== undefined && autoObj.anio !== null) autoObj.anio = String(autoObj.anio);
  autoObj.km = formatearMiles(autoObj.km);
  autoObj.precio = formatearMiles(autoObj.precio);
  autoObj.precio_oferta = formatearMiles(autoObj.precio_oferta);
  autoObj.precio_compra = formatearMiles(autoObj.precio_compra);

  if (publico) {
    delete autoObj.precio_compra;
    delete autoObj.fecha_compra;
    delete autoObj.propietario;
    delete autoObj.patente;
  }

  return autoObj;
};

// Toma lo que mande el front (string con puntos, string plano o número) y
// devuelve un entero limpio o null, listo para guardar en una columna INT.
const parsearEnteroLimpio = valor => {
  if (valor === null || valor === undefined || valor === "") return null;
  const limpio = String(valor).replace(/\./g, "").trim();
  if (!/^\d+$/.test(limpio)) return null;
  return parseInt(limpio, 10);
};

module.exports = { formatearMiles, formatearAutoParaRespuesta, parsearEnteroLimpio };
