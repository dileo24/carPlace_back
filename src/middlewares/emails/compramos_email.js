const nodeMailer = require("nodemailer");
const { User } = require("../../db");
require("dotenv").config();

const transporter = nodeMailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: true,
  auth: {
    user: process.env.EMAIL_FROM,
    pass: process.env.EMAIL_PASS,
  },
});

const sendCarFormEmail = async (req, res, next) => {
  try {
    const { nombre, email, telefono, marca, modelo, transmision, año, kilometros, detalles } = req.body;

    if (!nombre || !email || !telefono || !marca || !modelo || !transmision || !año || !kilometros) {
      return res.status(400).json({
        status: 400,
        error: "Todos los campos marcados como obligatorios son requeridos",
      });
    }

    const admins = await User.findAll({ where: { rol: "admin" }, attributes: ["email"] });
    const destinatarios = admins.map(a => a.email).join(",");

    const mailOptions = {
      from: email,
      to: destinatarios,
      subject: `Solicitud de venta de vehículo - ${marca} ${modelo}`,
      html: `
        <div style="width: 100%; background-color: #f5f5f5; padding: 20px; box-sizing: border-box;">
          <div style="max-width: 600px; margin: auto; background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);">
            <h2 style="color: #333; border-bottom: 2px solid #b61717; padding-bottom: 10px;">
              Solicitud de venta de vehículo
            </h2>
            
            <h3 style="color: #b61717; margin-top: 25px;">Información del cliente</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd; width: 40%; font-weight: bold;">Nombre completo:</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${nombre}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">Email:</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${email}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">Teléfono/Celular:</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${telefono}</td>
              </tr>
            </table>
            
            <h3 style="color: #b61717; margin-top: 25px;">Información del vehículo</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd; width: 40%; font-weight: bold;">Marca:</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${marca}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">Modelo y versión:</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${modelo}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">Transmisión:</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${transmision}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">Año:</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${año}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">Kilómetros:</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${kilometros} km</td>
              </tr>
              ${
                detalles
                  ? `
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd; font-weight: bold;">Detalles adicionales:</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${detalles}</td>
              </tr>
              `
                  : ""
              }
            </table>
            
            <div style="margin-top: 30px; text-align: center;">
              <a href="mailto:${email}" style="display: inline-block; background-color: #b61717; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">
                Contactar al cliente
              </a>
            </div>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    if (next) {
      next();
    } else {
      return res.status(200).json({
        status: 200,
        message: "Solicitud recibida correctamente. Te hemos enviado un email de confirmación.",
      });
    }
  } catch (error) {
    console.error("Error al enviar el email:", error);
    if (next) {
      next(error);
    } else {
      return res.status(500).json({
        status: 500,
        error: "Ocurrió un error al procesar tu solicitud. Por favor intenta nuevamente.",
      });
    }
  }
};

module.exports = sendCarFormEmail;
