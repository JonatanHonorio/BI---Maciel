import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { email, token, novaSenha } = await req.json();
  if (!email || !token || !novaSenha) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }
  if (String(novaSenha).length < 8) {
    return NextResponse.json({ error: "A senha precisa ter pelo menos 8 caracteres" }, { status: 400 });
  }

  const sql = getDb();
  const [usuario] = await sql`
    SELECT id, reset_token_hash, reset_token_expires FROM usuarios_bi
    WHERE email = ${String(email).toLowerCase().trim()} AND ativo = true
  `;

  const linkInvalido = () =>
    NextResponse.json({ error: "Link inválido ou expirado. Peça um novo em 'Esqueci minha senha'." }, { status: 400 });

  if (!usuario || !usuario.reset_token_hash || !usuario.reset_token_expires) return linkInvalido();
  if (new Date(usuario.reset_token_expires) < new Date()) return linkInvalido();

  const ok = await bcrypt.compare(token, usuario.reset_token_hash);
  if (!ok) return linkInvalido();

  const senhaHash = await bcrypt.hash(novaSenha, 10);
  await sql`
    UPDATE usuarios_bi
    SET senha_hash = ${senhaHash}, reset_token_hash = NULL, reset_token_expires = NULL
    WHERE id = ${usuario.id}
  `;

  return NextResponse.json({ ok: true });
}
