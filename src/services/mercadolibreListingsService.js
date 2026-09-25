const axios = require("axios");
const { Op } = require("sequelize");
const { obtenerAccessTokenValido } = require("./mercadolibreService");
const { getDolarBlue } = require("./dolarBlue");
const { Auto, Categoria, Publicacion } = require("../db");

// axios solo deja "Request failed with status code 400" en error.message — el
// detalle real (por qué la rechazó) viene en el body. Esto lo extrae para que
// el admin vea algo útil en vez de un 400 genérico.
function mensajeErrorML(error) {
  const data = error.response?.data;
  if (!data) return error.message;
  if (Array.isArray(data.cause) && data.cause.length) {
    return data.cause.map(c => c.message).join(" — ");
  }
  return data.message || error.message;
}

async function llamarML(fn, { reintentos = 0 } = {}) {
  for (let intento = 0; ; intento++) {
    try {
      return await fn();
    } catch (error) {
      // Detectado en vivo: ML a veces devuelve un error genérico tipo "Oops!
      // Something went wrong..." por una falla transitoria de su lado, incluso
      // cuando el cambio en realidad sí se aplicó del otro lado — un reintento
      // simple evita dejar un ⚠ falso en el CRM por una sincronización que en
      // los hechos funcionó.
      if (intento < reintentos) {
        await new Promise(r => setTimeout(r, 1000 * (intento + 1)));
        continue;
      }
      throw new Error(mensajeErrorML(error));
    }
  }
}

// Categoría real de MercadoLibre para autos/camionetas usados (verificado en
// vivo contra la API — MLA1743 "Autos, Motos y Otros" > MLA1744 "Autos y
// Camionetas"). Los value_id de acá abajo también salen de la API real, no
// están inventados.
const CATEGORY_ID = "MLA1744";
const VEHICLE_TYPE_VALUE_ID = "398351"; // único valor posible para VEHICLE_TYPE en esta categoría
const PRECIO_MINIMO_ARS = 100000; // piso que exige MercadoLibre para esta categoría

// ML rechaza (status "under_review", sub_status "forbidden") un auto con 0 km
// si el año es anterior a 2025 — política de la categoría, verificada en vivo
// (bug real detectado el 2026-09-07: autos sin km cargado en nuestra base
// mandaban "0 km" por default, quedando publicados como si fueran 0km nuevos
// siendo modelos viejos). Si un auto no es de este año o posterior y no tiene
// km real cargado, no tiene sentido publicarlo como si fuera 0km.
const ANIO_MINIMO_PARA_0KM = 2025;

const FUEL_TYPE_IDS = {
  Nafta: "64364",
  "Nafta/GNC": "372593",
  Diésel: "60406",
};

// Nuestro campo Auto.color guarda un hex (ver mapaColorAHex en
// procesarMensaje.js) — acá el mapeo inverso hacia el picklist real de color
// de MercadoLibre. Si el hex no matchea ninguno, se omite el atributo (no es
// obligatorio en esta categoría).
const COLOR_HEX_A_ML = {
  "#FFFFFF": { id: "52055", name: "Blanco" },
  "#F5F5F5": { id: "52055", name: "Blanco" },
  "#000000": { id: "52049", name: "Negro" },
  "#FF0000": { id: "51993", name: "Rojo" },
  "#8B0000": { id: "51998", name: "Bordó" },
  "#C0C0C0": { id: "52053", name: "Plateado" },
  "#808080": { id: "283165", name: "Gris" },
  "#A9A9A9": { id: "283165", name: "Gris" },
  "#D3D3D3": { id: "283165", name: "Gris" },
  "#0000FF": { id: "52028", name: "Azul" },
  "#00008B": { id: "52033", name: "Azul oscuro" },
  "#ADD8E6": { id: "52029", name: "Azul claro" },
  "#FFA500": { id: "52000", name: "Naranja" },
  "#228B22": { id: "52014", name: "Verde" },
  "#006400": { id: "52019", name: "Verde oscuro" },
  "#D2691E": { id: "52005", name: "Marrón" },
  "#F5DEB3": { id: "52001", name: "Beige" },
};

// Ubicación fija del local (Sportquatro, Córdoba Capital) — sacada de una
// publicación real ya hecha a mano por el admin (MLA3907510556), con los
// mismos ids que usa MercadoLibre internamente para ciudad/provincia/barrio.
// Mandar solo nombres sin estos ids (como hacía el código viejo, sacando la
// dirección de /users/me) hace que ML muestre el código crudo de provincia
// ("Córdoba, AR-X") en vez del nombre — por eso va hardcodeado así.
const UBICACION_FIJA = {
  address_line: "",
  zip_code: "",
  neighborhood: { id: "TVhYVmlsbGEgQ2FicmVyYVRVeEJRME5CVUdOa", name: "Villa Cabrera" },
  city: { id: "TUxBQ0NBUGNiZGQx", name: "Córdoba" },
  state: { id: "TUxBUENPUmFkZGIw", name: "Córdoba" },
  country: { id: "AR", name: "Argentina" },
  latitude: -31.3851503,
  longitude: -64.217285,
};

// Teléfono/WhatsApp del local — mismo que carga el admin a mano en cada
// publicación (ver seller_contact en MLA3907510556). Sin esto, ML muestra el
// botón genérico "Preguntar" en vez del botón de WhatsApp.
const CONTACTO_FIJO = {
  country_code: "54",
  area_code: "",
  phone: "93512147804",
  country_code2: "54",
  area_code2: "",
  phone2: "93512147804",
};

// ids booleanos genéricos de MercadoLibre (Sí/No) — los mismos que usa
// cualquier atributo boolean de la categoría (ver HAS_ABS_BRAKES, etc).
const ML_SI = "242085";

// "Ofrezco facilidades de pago" siempre tildado, con un anticipo del 45% del
// precio — pedido puntual del admin. Se manda igual en cada publicación y se
// vuelve a mandar en cada actualización de precio, para que el anticipo
// siempre siga el precio vigente. El anticipo va en la misma moneda en la
// que se publica el auto (currencyId), nunca fijo en ARS.
function resolverSaleTerms(precio, currencyId) {
  const anticipo = Math.round(precio * 0.45);
  return [
    { id: "WITH_FINANCING_OPTIONS", value_id: ML_SI },
    // number_unit: igual que KILOMETERS en resolverAtributos, va como
    // value_name "<numero> <unidad>" — mandado como value_struct no lo toma
    // (verificado en vivo: lo ignora en silencio, sin tirar error).
    { id: "INITIAL_PAYMENT_AMOUNT", value_name: `${anticipo} ${currencyId}` },
  ];
}

// Categorías propias que ya usamos para etiquetar la carrocería (ver
// CATEGORIAS_ESPERADAS en index.js) — de ahí sacamos DOORS, que ML pide
// obligatorio y nuestro modelo Auto no guarda directamente.
const PUERTAS_POR_CATEGORIA = {
  "5 Puertas": 5,
  "4 Puertas": 4,
  "3 Puertas": 3,
};
const PUERTAS_DEFAULT = 5;

const normalizar = str =>
  (str || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const parsearKm = km => parseInt(String(km || "0").replace(/\./g, ""), 10) || 0;

// Auto.marca tiene casing inconsistente (autos viejos guardados en minúscula,
// ver módulo Marcas) — para el título por defecto de la publicación conviene
// capitalizar, se ve poco profesional un "volkswagen" en minúscula en ML.
const capitalizarMarca = str =>
  (str || "")
    .toString()
    .split(" ")
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

// Nuestro Auto.modelo guarda un único string largo ("Amarok 2.0 Cd Tdi 180cv
// 4x2 Trendline B33"), pero ML pide MODEL y TRIM como dos atributos separados
// y obligatorios. Mandar el mismo string completo en los dos (como se hacía
// antes) hace que el título/ficha de la publicación lo muestre duplicado (ej.
// "...Trendline B33 Amarok 2.0 Cd Tdi 180cv 4x2 Trendline B33" — bug real
// visto en vivo el 2026-09-04). Se separa por el primer espacio: la primera
// palabra como MODEL (ej. "Amarok"), el resto como TRIM (ej. "2.0 Cd Tdi
// 180cv 4x2 Trendline B33") — mismo patrón que usa una publicación real hecha
// a mano (MODEL "Duster" / TRIM "1.6 Ph2 4x2 Privilege").
function separarModeloYTrim(modelo) {
  const texto = (modelo || "").toString().trim();
  const espacio = texto.indexOf(" ");
  if (espacio === -1) return { model: texto, trim: texto };
  return { model: texto.slice(0, espacio), trim: texto.slice(espacio + 1) };
}

// Cache en memoria del proceso — la lista de marcas de ML no cambia con
// frecuencia, no tiene sentido pedirla de nuevo en cada publicación.
let cacheMarcas = null;
async function obtenerBrandValueId(marca, headers) {
  if (!cacheMarcas) {
    const { data } = await axios.get(
      `https://api.mercadolibre.com/categories/${CATEGORY_ID}/attributes`,
      { headers },
    );
    const brand = data.find(a => a.id === "BRAND");
    cacheMarcas = new Map((brand?.values || []).map(v => [normalizar(v.name), v.id]));
  }
  return cacheMarcas.get(normalizar(marca)) || null;
}

function resolverPuertas(auto) {
  const categorias = (auto.categorias || []).map(c => c.categ);
  for (const [nombre, cantidad] of Object.entries(PUERTAS_POR_CATEGORIA)) {
    if (categorias.includes(nombre)) return cantidad;
  }
  return PUERTAS_DEFAULT;
}

// Devuelve el precio en la MISMA moneda en la que está cargado el auto en el
// CRM — la publicación en MercadoLibre tiene que quedar en esa moneda, nunca
// convertida a ARS. precioARSequivalente es solo para validar el piso de
// precio que exige ML (PRECIO_MINIMO_ARS), nunca se publica.
async function resolverPrecio(auto) {
  const precioEfectivo = auto.oferta && auto.precio_oferta ? auto.precio_oferta : auto.precio;
  const precioRaw = parseInt(String(precioEfectivo).replace(/\./g, ""), 10) || 0;
  const esUSD = auto.moneda === "USD" || auto.moneda === "U$D";

  let precioARSequivalente = precioRaw;
  if (esUSD) {
    const dolarBlue = await getDolarBlue();
    if (!dolarBlue) throw new Error("No se pudo obtener la cotización del dólar para validar el precio.");
    precioARSequivalente = Math.round(precioRaw * dolarBlue);
  }

  return { precio: precioRaw, currencyId: esUSD ? "USD" : "ARS", precioARSequivalente };
}

async function resolverAtributos(auto, headers) {
  const brandId = await obtenerBrandValueId(auto.marca, headers);
  if (!brandId) {
    throw new Error(`No se encontró la marca "${auto.marca}" en el listado de MercadoLibre.`);
  }

  const fuelId = FUEL_TYPE_IDS[auto.combustible];
  if (!fuelId) {
    throw new Error(`El combustible "${auto.combustible}" no está soportado para publicar en MercadoLibre.`);
  }

  const { model, trim } = separarModeloYTrim(auto.modelo);

  const attributes = [
    { id: "BRAND", value_id: brandId },
    { id: "MODEL", value_name: model },
    { id: "VEHICLE_YEAR", value_name: String(auto.anio) },
    { id: "TRIM", value_name: trim },
    { id: "VEHICLE_TYPE", value_id: VEHICLE_TYPE_VALUE_ID },
    { id: "FUEL_TYPE", value_id: fuelId },
    { id: "DOORS", value_name: String(resolverPuertas(auto)) },
    { id: "KILOMETERS", value_name: `${parsearKm(auto.km)} km` },
  ];

  const colorML = COLOR_HEX_A_ML[(auto.color || "").toUpperCase()];
  if (colorML) attributes.push({ id: "COLOR", value_id: colorML.id });

  return attributes;
}

function parsearFotos(img) {
  // Auto.img es DataTypes.JSON, pero en este proyecto MySQL siempre lo
  // devuelve como string sin parsear (comportamiento ya conocido en el resto
  // del código, ver procesarMensaje.js) — hay que guardarse SIEMPRE de esto,
  // si no se manda un string suelto como si fuera una URL de foto.
  const lista = typeof img === "string" ? JSON.parse(img) : img;
  return Array.isArray(lista) ? lista : [];
}

// No confirmado el máximo real de MercadoLibre para esta categoría, pero el
// admin pidió subir hasta 20 fotos por auto justamente porque ML exige un
// mínimo de 15 — el tope acá tiene que dejar pasar todas esas, si no la
// publicación queda con menos fotos de las que el admin cargó sin que se note.
const MAX_FOTOS_ML = 20;

// Logo pedido por el admin — tiene que quedar SIEMPRE como la última foto de
// la publicación. Subido una sola vez a Cloudinary (carpeta "sistema", no
// "general", para no mezclarlo con las fotos de los autos ni que la limpieza
// de fotos huérfanas de un auto lo toque).
const LOGO_ML_URL = "https://res.cloudinary.com/dxhbxhtk1/image/upload/v1788470421/sistema/rimjgwnmytxqndgpvnwy.webp";

// Arma el array de "pictures" para ML: las fotos del auto (recortadas para
// dejar lugar) + el logo siempre al final. Se comparte entre crear y
// actualizar para que el logo nunca se pierda ni cambie de posición.
function armarFotosParaML(auto) {
  const fotosAuto = parsearFotos(auto.img).slice(0, MAX_FOTOS_ML - 1);
  return [...fotosAuto.map(url => ({ source: url })), { source: LOGO_ML_URL }];
}

// MercadoLibre da una cantidad de publicaciones Oro/Plata por mes que varía
// (no hay un número fijo documentado) — esto consulta cuánto queda en vivo.
async function obtenerCupoDisponible() {
  const token = await obtenerAccessTokenValido();
  if (!token) throw new Error("No hay ninguna cuenta de MercadoLibre conectada.");
  const headers = { Authorization: `Bearer ${token}` };

  const { data: me } = await axios.get("https://api.mercadolibre.com/users/me", { headers });
  const { data } = await axios.get(
    `https://api.mercadolibre.com/users/${me.id}/available_listing_types?category_id=${CATEGORY_ID}`,
    { headers },
  );

  const cupos = { gold: 0, silver: 0 };
  for (const item of data.available || []) {
    if (item.id === "gold" || item.id === "silver") cupos[item.id] = item.remaining_listings;
  }
  return cupos;
}

async function crearPublicacionMercadoLibre(autoId, { titulo, descripcion, listingType = "silver" } = {}) {
  const token = await obtenerAccessTokenValido();
  if (!token) throw new Error("No hay ninguna cuenta de MercadoLibre conectada.");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const tipoFinal = listingType === "gold" ? "gold" : "silver";
  const cupos = await obtenerCupoDisponible();
  if (cupos[tipoFinal] <= 0) {
    const label = tipoFinal === "gold" ? "Oro" : "Plata";
    throw new Error(
      `Llegaste al límite de publicaciones tipo ${label} de este mes en MercadoLibre (0 disponibles). Probá con el otro tipo o esperá a que se renueve el cupo.`,
    );
  }

  const auto = await Auto.findByPk(autoId, {
    include: [{ model: Categoria, as: "categorias" }],
  });
  if (!auto) throw new Error(`Auto ${autoId} no encontrado.`);

  const { precio, currencyId, precioARSequivalente } = await resolverPrecio(auto);
  if (precioARSequivalente < PRECIO_MINIMO_ARS) {
    throw new Error(
      `El precio (AR$ ${precioARSequivalente}) está por debajo del mínimo que exige MercadoLibre para esta categoría (AR$ ${PRECIO_MINIMO_ARS}).`,
    );
  }

  if (parsearKm(auto.km) === 0 && Number(auto.anio) < ANIO_MINIMO_PARA_0KM) {
    throw new Error(
      `Este auto no tiene kilometraje cargado (o está en 0 km) y es del año ${auto.anio} — MercadoLibre no permite publicar autos anteriores a ${ANIO_MINIMO_PARA_0KM} con 0 km. Cargá el kilometraje real antes de publicarlo.`,
    );
  }

  const attributes = await resolverAtributos(auto, headers);

  if (parsearFotos(auto.img).length === 0) {
    throw new Error("El auto no tiene fotos cargadas — MercadoLibre exige al menos una.");
  }

  const tituloFinal = titulo || `${capitalizarMarca(auto.marca)} ${auto.modelo} ${auto.anio}`.trim();

  const payload = {
    category_id: CATEGORY_ID,
    title: tituloFinal,
    condition: parsearKm(auto.km) === 0 ? "new" : "used",
    price: precio,
    currency_id: currencyId,
    available_quantity: 1,
    listing_type_id: tipoFinal,
    location: UBICACION_FIJA,
    seller_contact: CONTACTO_FIJO,
    sale_terms: resolverSaleTerms(precio, currencyId),
    pictures: armarFotosParaML(auto),
    attributes,
  };

  const { data: item } = await llamarML(() => axios.post("https://api.mercadolibre.com/items", payload, { headers }));

  if (descripcion) {
    await llamarML(() =>
      axios.post(`https://api.mercadolibre.com/items/${item.id}/description`, { plain_text: descripcion }, { headers }),
    );
  }

  return { itemId: item.id, permalink: item.permalink, status: item.status, tituloUsado: tituloFinal };
}

// Actualiza precio/km/fotos/color de una publicación ya existente — pensado
// para engancharse a updateAuto.js. Nunca toca título/descripción (eso lo
// escribe el admin a mano, no se pisa solo).
async function actualizarPublicacionMercadoLibre(externalId, autoId) {
  const token = await obtenerAccessTokenValido();
  if (!token) throw new Error("No hay ninguna cuenta de MercadoLibre conectada.");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const auto = await Auto.findByPk(autoId, {
    include: [{ model: Categoria, as: "categorias" }],
  });
  if (!auto) throw new Error(`Auto ${autoId} no encontrado.`);

  // No se manda currency_id acá — ML no permite cambiar la moneda de un item
  // ya publicado. Si la moneda del auto en el CRM cambió después de
  // publicado (caso raro, no debería pasar en el uso normal), el precio
  // quedaría en la escala equivocada porque el item sigue en la moneda
  // original — no contemplado a propósito, no es el caso que se reportó.
  const { precio, currencyId } = await resolverPrecio(auto);

  const attributes = [
    { id: "KILOMETERS", value_name: `${parsearKm(auto.km)} km` },
  ];
  const colorML = COLOR_HEX_A_ML[(auto.color || "").toUpperCase()];
  if (colorML) attributes.push({ id: "COLOR", value_id: colorML.id });

  const payload = { price: precio, attributes, sale_terms: resolverSaleTerms(precio, currencyId) };
  if (parsearFotos(auto.img).length > 0) payload.pictures = armarFotosParaML(auto);

  const { data } = await llamarML(
    () => axios.put(`https://api.mercadolibre.com/items/${externalId}`, payload, { headers }),
    { reintentos: 1 },
  );
  return data;
}

async function cambiarEstadoPublicacion(externalId, estado) {
  const token = await obtenerAccessTokenValido();
  if (!token) throw new Error("No hay ninguna cuenta de MercadoLibre conectada.");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const { data } = await llamarML(() =>
    axios.put(`https://api.mercadolibre.com/items/${externalId}`, { status: estado }, { headers }),
  );
  return data;
}

const pausarPublicacionMercadoLibre = externalId => cambiarEstadoPublicacion(externalId, "paused");
const reactivarPublicacionMercadoLibre = externalId => cambiarEstadoPublicacion(externalId, "active");
// "Cerrar/Finalizar": status:"closed" — queda como "Inactiva" en el panel de
// ML, visible en el historial del vendedor.
const cerrarPublicacionMercadoLibre = externalId => cambiarEstadoPublicacion(externalId, "closed");

// "Eliminar": acción distinta a cerrar — verificado en vivo que no existe un
// DELETE real en la API de ML (405 Method Not Allowed). Lo que hace el botón
// "Eliminar" del panel es mandar deleted:true, que además de cerrarla la saca
// del todo del listado (a diferencia de "cerrar", que la deja visible como
// "Inactiva"). De paso, esto también permite eliminar una publicación que
// quedó trabada en not_yet_active, donde un simple status:"closed" es
// rechazado.
async function eliminarPublicacionMercadoLibre(externalId) {
  const token = await obtenerAccessTokenValido();
  if (!token) throw new Error("No hay ninguna cuenta de MercadoLibre conectada.");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // ML solo deja marcar deleted:true sobre un item que ya está "closed" — si
  // sigue "active"/"paused" rechaza el PUT con "deleted is not modifiable".
  // Se cierra primero (best-effort: si ya estaba cerrado, este PUT puede
  // fallar con un error inofensivo tipo "ya está cerrado", que se ignora a
  // propósito) y recién después se intenta el delete real.
  try {
    await axios.put(`https://api.mercadolibre.com/items/${externalId}`, { status: "closed" }, { headers });
  } catch (_) {
    // Seguimos igual al intento de delete de abajo.
  }

  const { data } = await llamarML(() =>
    axios.put(`https://api.mercadolibre.com/items/${externalId}`, { deleted: true }, { headers }),
  );
  return data;
}

// Chequea el estado real de un item en ML — usado como red de seguridad
// cuando el admin gestiona una publicación directamente en MercadoLibre (la
// pausa, cierra o elimina desde ahí) y después intenta una acción desde el
// CRM sobre una fila que quedó desactualizada (ver cambiarEstadoPublicacion.js).
async function consultarEstadoReal(externalId) {
  const token = await obtenerAccessTokenValido();
  if (!token) throw new Error("No hay ninguna cuenta de MercadoLibre conectada.");
  const headers = { Authorization: `Bearer ${token}` };

  const { data } = await llamarML(() => axios.get(`https://api.mercadolibre.com/items/${externalId}`, { headers }));
  return data;
}

// Traduce el status/sub_status real de ML a nuestro enum de Publicacion.estado
// — usado tanto para la reconciliación reactiva (cuando una acción del CRM
// falla, ver cambiarEstadoPublicacion.js) como para el chequeo proactivo al
// listar publicaciones (ver getPublicaciones.js), así el admin no depende de
// tocar un botón para enterarse de que algo cambió del lado de ML.
function interpretarEstadoReal(real) {
  if (real.status === "active") return { estado: "publicada", motivo: null };
  if (real.status === "paused") return { estado: "pausada", motivo: null };

  if (real.status === "closed") {
    return real.sub_status?.includes("deleted")
      ? { estado: "eliminada", motivo: null }
      : { estado: "cerrada", motivo: null };
  }

  // "under_review" + "forbidden": ML rechazó la publicación por una política
  // de la categoría (ej. auto viejo cargado como 0 km — ver
  // ANIO_MINIMO_PARA_0KM). No hay un endpoint público con el texto exacto que
  // ML le muestra al vendedor en su panel, así que se arma el motivo más
  // probable a partir de los datos que ya tenemos, con un mensaje genérico
  // como último recurso.
  if (real.status === "under_review" && real.sub_status?.includes("forbidden")) {
    // El número viene anidado en values[0].struct, no directo en el atributo
    // — más simple y robusto parsear el entero al principio de value_name
    // ("0 km" / "108000 km") que andar bajando por esa estructura.
    const kmValueName = real.attributes?.find(a => a.id === "KILOMETERS")?.value_name;
    const km = kmValueName != null ? parseInt(kmValueName, 10) : null;
    const anioAttr = real.attributes?.find(a => a.id === "VEHICLE_YEAR")?.value_name;
    const motivo =
      km === 0 && anioAttr && Number(anioAttr) < ANIO_MINIMO_PARA_0KM
        ? `MercadoLibre rechazó esta publicación: no permite autos anteriores a ${ANIO_MINIMO_PARA_0KM} con 0 km. Cargá el kilometraje real del auto y volvé a intentar.`
        : "MercadoLibre puso esta publicación en revisión y la rechazó (forbidden) — entrá a su panel para ver el motivo exacto.";
    return { estado: "error", motivo };
  }

  // not_yet_active y cualquier otro estado no mapeado explícitamente: se deja
  // como está (not_yet_active es un pendiente normal recién creado, no un
  // problema — ver crearPublicacionMercadoLibre).
  return null;
}

// Cuando un auto se borra del todo (venta o eliminación manual desde el CRM)
// hay que sacarlo también de MercadoLibre antes — si no, la publicación queda
// huérfana allá (activa o pausada). Best-effort: un fallo en una publicación
// no frena el resto ni la baja del auto (mismo criterio que el borrado de
// fotos en Cloudinary en deleteAuto.js/createVenta.js) — pero a diferencia de
// antes, la fila de Publicacion YA NO se pierde (autoId queda en null vía
// ON DELETE SET NULL, ver db.js) y devuelve las que fallaron para que
// deleteAuto.js pueda avisarle al admin en vez de fallar en silencio.
async function eliminarPublicacionesDeAuto(autoId) {
  const publicaciones = await Publicacion.findAll({
    where: { autoId, estado: { [Op.in]: ["publicada", "pausada"] } },
  });

  const fallidas = [];
  for (const publicacion of publicaciones) {
    try {
      await eliminarPublicacionMercadoLibre(publicacion.externalId);
      await publicacion.update({ estado: "eliminada", ultimoErrorMensaje: null });
    } catch (err) {
      console.error(`No se pudo eliminar la publicación ${publicacion.id} de MercadoLibre:`, err.message);
      await publicacion
        .update({ ultimoErrorMensaje: `No se pudo eliminar de MercadoLibre al borrar el auto: ${err.message}` })
        .catch(() => {});
      fallidas.push({ id: publicacion.id, externalId: publicacion.externalId, motivo: err.message });
    }
  }
  return fallidas;
}

module.exports = {
  crearPublicacionMercadoLibre,
  actualizarPublicacionMercadoLibre,
  pausarPublicacionMercadoLibre,
  cerrarPublicacionMercadoLibre,
  eliminarPublicacionMercadoLibre,
  reactivarPublicacionMercadoLibre,
  eliminarPublicacionesDeAuto,
  consultarEstadoReal,
  interpretarEstadoReal,
  obtenerCupoDisponible,
};
