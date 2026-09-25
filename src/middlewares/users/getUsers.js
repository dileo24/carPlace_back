const { User } = require("../../db");

const getUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ["id", "name", "email", "rol", "color", "createdAt"],
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json({ status: 200, users });
  } catch (err) {
    console.error("Error en getUsers:", err);
    return res.status(500).json({
      status: 500,
      error: err.message || "Error en el servidor",
    });
  }
};

module.exports = getUsers;