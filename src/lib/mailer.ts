import nodemailer from "nodemailer";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

export async function enviarEmailRedefinirSenha(destino: string, nome: string, link: string) {
  await getTransporter().sendMail({
    from: `"BI Maciel" <${process.env.SMTP_USER}>`,
    to: destino,
    subject: "Defina sua senha — BI Maciel",
    text:
      `Olá, ${nome}.\n\n` +
      `Clique no link abaixo para definir sua senha de acesso ao BI Maciel (válido por 1 hora):\n${link}\n\n` +
      `Se você não pediu isso, pode ignorar este e-mail.`,
    html: `
      <p>Olá, ${nome}.</p>
      <p>Clique no botão abaixo para definir sua senha de acesso ao BI Maciel. O link vale por 1 hora.</p>
      <p><a href="${link}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Definir senha</a></p>
      <p style="color:#666;font-size:13px">Se você não pediu isso, pode ignorar este e-mail.</p>
    `,
  });
}
