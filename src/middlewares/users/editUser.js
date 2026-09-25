// controllers/users/editUser.js
const { User } = require("../../db");
const { encrypt } = require("../../helpers/handleCrypt");

const VALID_ROLES = ["admin", "supervisor", "vendedor", "publicador_vendedor", "socio"];

const editUser = async (req, res) => {
  try {
    const { id } = req.params;
    let { name, email, pass, rol, color } = req.body;
    const errors = [];

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        status: 404,
        error: "Usuario no encontrado.",
      });
    }

    if (name !== undefined && !name?.trim()) {
      errors.push({ resp: "El nombre no puede estar vacío.", input: "name" });
    }
    if (email !== undefined && !email?.trim()) {
      errors.push({ resp: "El email no puede estar vacío.", input: "email" });
    }
    if (rol !== undefined && !VALID_ROLES.includes(rol)) {
      errors.push({ resp: "Rol inválido.", input: "rol" });
    }

    if (errors.length > 0) {
      return res.status(400).json({ status: 400, errors });
    }

    if (email) {
      email = email.trim().toLowerCase();
      const existing = await User.findOne({ where: { email } });
      if (existing && existing.id !== parseInt(id)) {
        return res.status(400).json({
          status: 400,
          errors: [{ resp: "Ese email ya está registrado.", input: "email" }],
        });
      }
    }

    const updates = {};
    if (name) updates.name = name.trim();
    if (email) updates.email = email;
    if (rol) updates.rol = rol;
    if (color !== undefined) updates.color = color || null;
    if (pass) updates.pass = await encrypt(pass);

    await user.update(updates);

    return res.status(200).json({
      status: 200,
      message: "Usuario actualizado correctamente.",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        rol: user.rol,
        color: user.color,
      },
    });
  } catch (err) {
    console.error("Error en editUser:", err);
    return res.status(500).json({
      status: 500,
      error: err.message || "Error en el servidor",
    });
  }
};

module.exports = editUser;