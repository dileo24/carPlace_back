// controllers/users/deleteUser.js
const { User } = require("../../db");

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        status: 404,
        error: "Usuario no encontrado.",
      });
    }

    await user.destroy();

    return res.status(200).json({
      status: 200,
      message: "Usuario eliminado correctamente.",
    });
  } catch (err) {
    console.error("Error en deleteUser:", err);
    return res.status(500).json({
      status: 500,
      error: err.message || "Error en el servidor",
    });
  }
};

module.exports = deleteUser;