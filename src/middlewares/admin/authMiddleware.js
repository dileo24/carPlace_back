const jwt = require("jsonwebtoken");

const verifyToken = req => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.split(" ")[1];

  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }
};

// Requiere un JWT válido. Puebla req.user con { id, rol, nombre, apellido }.
// Además reemite un token nuevo (misma validez de 18hs) en cada request, para
// que una sesión activa nunca expire — el cliente lo toma del header y
// reemplaza el que tenía guardado. Si el usuario deja de usar el sistema por
// más de 18hs seguidas, ahí sí vuelve a pedir login.
const authMiddleware = (req, res, next) => {
  const decoded = verifyToken(req);

  if (!decoded) {
    return res.status(401).json({
      status: 401,
      error: "No autenticado o sesión inválida",
    });
  }

  req.user = decoded;

  const { id, rol, nombre, apellido } = decoded;
  const refreshedToken = jwt.sign({ id, rol, nombre, apellido }, process.env.JWT_SECRET, {
    expiresIn: "18h",
  });
  res.setHeader("X-Refreshed-Token", refreshedToken);

  next();
};

// Igual que authMiddleware pero no rechaza si no hay token — útil para rutas
// públicas cuya respuesta varía si quien pregunta está logueado (ej. catálogo).
const optionalAuth = (req, res, next) => {
  const decoded = verifyToken(req);
  if (decoded) req.user = decoded;
  next();
};

// Debe usarse después de authMiddleware/optionalAuth.
const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol)) {
      return res.status(403).json({ status: 403, error: "Sin permiso para esta acción" });
    }
    next();
  };

module.exports = { authMiddleware, optionalAuth, requireRole };
