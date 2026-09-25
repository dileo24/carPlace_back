// controllers/users/createUser.js
const { User } = require("../../db");
const { encrypt } = require("../../helpers/handleCrypt");

const VALID_ROLES = ["supervisor", "vendedor", "publicador_vendedor", "socio"];

const createUser = async (req, res) => {
  try {
    let { name, email, pass, rol, color } = req.body;
    const errors = [];

    if (!name?.trim()) errors.push({ resp: "El nombre es obligatorio.", input: "name" });
    if (!email?.trim()) errors.push({ resp: "El email es obligatorio.", input: "email" });
    if (!pass) errors.push({ resp: "La contraseña es obligatoria.", input: "pass" });
    if (!rol || !VALID_ROLES.includes(rol)) {
      errors.push({ resp: `Rol inválido.`, input: "rol" });
    }

    if (errors.length > 0) {
      return res.status(400).json({ status: 400, errors });
    }

    email = email.trim().toLowerCase();
    name = name.trim();

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(400).json({
        status: 400,
        errors: [{ resp: "Ese email ya está registrado.", input: "email" }],
      });
    }

    const hashedPass = await encrypt(pass);
    const newUser = await User.create({ name, email, pass: hashedPass, rol, color: color || null });

    return res.status(201).json({
      status: 201,
      message: "Usuario creado correctamente.",
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        rol: newUser.rol,
        color: newUser.color,
      },
    });
  } catch (err) {
    console.error("Error en createUser:", err);
    return res.status(500).json({
      status: 500,
      error: err.message || "Error en el servidor",
    });
  }
};

module.exports = createUser;