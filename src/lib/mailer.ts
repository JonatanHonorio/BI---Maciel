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

interface AvisoContrato {
  ref: string;
  fase: string;
  tipo: string;
  endereco: string | null;
  corretor: string | null;
  quem: string;
  comentario: string | null;
  link: string;
}

/**
 * Aviso de andamento de contrato para o gerente da unidade.
 *
 * O assunto carrega ref e fase porque é o que aparece na notificação do
 * celular — "BI Maciel: atualização" mandaria o gerente abrir o e-mail só pra
 * descobrir de qual contrato se trata.
 */
export async function enviarEmailContrato(destino: string, nome: string, a: AvisoContrato) {
  const linhas = [
    `Referência: ${a.ref}`,
    `Tipo: ${a.tipo}`,
    a.endereco ? `Imóvel: ${a.endereco}` : null,
    a.corretor ? `Corretor: ${a.corretor}` : null,
    `Fase: ${a.fase}`,
    `Movido por: ${a.quem}`,
    a.comentario ? `Observação: ${a.comentario}` : null,
  ].filter(Boolean) as string[];

  await getTransporter().sendMail({
    from: `"BI Maciel" <${process.env.SMTP_USER}>`,
    to: destino,
    subject: `Contrato ${a.ref} — ${a.fase}`,
    text: `Olá, ${nome}.\n\n${linhas.join("\n")}\n\nAbrir no BI: ${a.link}\n`,
    html: `
      <p>Olá, ${nome}.</p>
      <table style="border-collapse:collapse;font-size:14px">
        ${linhas
          .map((l) => {
            const [rotulo, ...resto] = l.split(": ");
            return `<tr><td style="padding:2px 12px 2px 0;color:#666">${rotulo}</td><td style="padding:2px 0"><strong>${resto.join(": ")}</strong></td></tr>`;
          })
          .join("")}
      </table>
      <p style="margin-top:16px"><a href="${a.link}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Abrir contrato no BI</a></p>
    `,
  });
}
