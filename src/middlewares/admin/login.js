// controllers/auth/login.js
const jwt = require("jsonwebtoken");
const { User } = require("../../db");
const { checkers } = require("../../helpers/checkers");
const { compare } = require("../../helpers/handleCrypt");
require("dotenv").config();

const login = async (req, res) => {
  try {
    let { email, pass } = req.body;
    const errors = [];

    if (!email) await checkAndPushError(errors, "email", email);
    if (!pass) await checkAndPushError(errors, "pass", pass);

    if (errors.length > 0) {
      return res.status(400).json({ status: 400, errors });
    }

    email = email.trim().toLowerCase();

    const account = await User.findOne({ where: { email } });
    const rol = account?.rol ?? null;

    if (!account) {
      return res.status(400).json({
        status: 400,
        errors: [{ resp: "Su email no se encuentra registrado.", input: "email" }],
      });
    }

    const checkPass = await compare(pass, account.pass);
    if (!checkPass) {
      return res.status(400).json({
        status: 400,
        errors: [{ resp: "¡Contraseña incorrecta!", input: "pass" }],
      });
    }

    const nombreCompleto = account.name ?? "";
    const [nombre, ...restoApellido] = nombreCompleto.split(" ");
    const apellido = restoApellido.join(" ");

    const token = jwt.sign(
      { id: account.id, rol, nombre: nombre || "", apellido },
      process.env.JWT_SECRET,
      { expiresIn: "18h" },
    );

    return res.status(200).json({
      status: 200,
      resp: "login_success",
      message: "Inicio de sesión exitoso",
      token,
      user: {
        id: account.id,
        name: account.name ?? null,
        email: account.email,
        rol,
      },
    });
  } catch (err) {
    console.error("Error en login:", err);
    return res.status(500).json({
      status: 500,
      error: err.message || "Error en el servidor",
    });
  }
};

async function checkAndPushError(errors, type, data) {
  try {
    await checkers(type, data);
  } catch (err) {
    errors.push({ resp: err.resp, input: err.input });
  }
}

module.exports = login;