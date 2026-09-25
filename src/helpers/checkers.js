const checkers = async (tipo, dato) => {
  switch (tipo) {
    case "pass":
      if (!dato) {
        throw {
          status: 400,
          resp: "¡La contraseña es obligatoria!",
          input: "pass",
        };
      }
      break;
    case "email":
      if (!dato) {
        throw {
          status: 400,
          resp: "¡El email es obligatorio!",
          input: "email",
        };
      }
      break;
   default:
      break;
  }
};

module.exports = { checkers };
