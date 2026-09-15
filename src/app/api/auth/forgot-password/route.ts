import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { enviarEmailRedefinirSenha } from "@/lib/mailer";

const MENSAGEM_GENERICA = { ok: true, mensagem: "Se o e-mail existir, o link foi enviado." };

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: "Informe o e-mail" }, { status: 400 });

  const sql = getDb();
  const [usuario] = await sql`
    SELECT id, email, nome FROM usuarios_bi
    WHERE email = ${String(email).toLowerCase().trim()} AND ativo = true
  `;

  // Resposta genérica sempre, pra não revelar quais e-mails têm conta.
  if (!usuario) return NextResponse.json(MENSAGEM_GENERICA);

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = await bcrypt.hash(token, 10);
  const expira = new Date(Date.now() + 60 * 60 * 1000); // 1h

  await sql`
    UPDATE usuarios_bi
    SET reset_token_hash = ${tokenHash}, reset_token_expires = ${expira.toISOString()}
    WHERE id = ${usuario.id}
  `;

  const link = `${process.env.APP_URL}/reset-password?email=${encodeURIComponent(usuario.email)}&token=${token}`;

  try {
    await enviarEmailRedefinirSenha(usuario.email, usuario.nome, link);
  } catch (e) {
    console.error("Falha ao enviar e-mail de redefinição de senha:", e);
    return NextResponse.json({ error: "Não foi possível enviar o e-mail agora" }, { status: 500 });
  }

  return NextResponse.json(MENSAGEM_GENERICA);
}
