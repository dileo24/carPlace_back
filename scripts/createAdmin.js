// Crea un usuario con rol admin a mano, una vez que la app y la base ya están
// levantadas. Se corre por SSH — así el mail/contraseña del primer admin
// nunca queda cargado como variable de entorno en el panel de hosting.
//
// Uso: node scripts/createAdmin.js "Nombre Apellido" correo@ejemplo.com contraseña

const { conn, User } = require("../src/db");
const { encrypt } = require("../src/helpers/handleCrypt");

async function run() {
  const [name, emailRaw, pass] = process.argv.slice(2);

  if (!name || !emailRaw || !pass) {
    console.error('Uso: node scripts/createAdmin.js "Nombre Apellido" correo@ejemplo.com contraseña');
    process.exitCode = 1;
    return;
  }

  const email = emailRaw.trim().toLowerCase();

  const existing = await User.findOne({ where: { email } });
  if (existing) {
    console.error(`Ya existe un usuario con ese email (rol actual: ${existing.rol}).`);
    process.exitCode = 1;
    return;
  }

  const admin = await User.create({
    name: name.trim(),
    email,
    pass: await encrypt(pass),
    rol: "admin",
  });

  console.log(`Admin creado: ${admin.name} <${admin.email}> (id ${admin.id})`);
}

run()
  .catch(err => {
    console.error("Falló la creación del admin:", err);
    process.exitCode = 1;
  })
  .finally(() => conn.close());
