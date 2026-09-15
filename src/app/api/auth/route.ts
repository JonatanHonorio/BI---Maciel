import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { signSession, SESSION_COOKIE, Session } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { email, senha } = await req.json();
  if (!email || !senha) {
    return NextResponse.json({ error: "Informe e-mail e senha" }, { status: 400 });
  }

  const sql = getDb();
  const [usuario] = await sql`
    SELECT id, email, nome, senha_hash, role, unidade, tipo, marketing
    FROM usuarios_bi
    WHERE email = ${String(email).toLowerCase().trim()} AND ativo = true
  `;

  if (!usuario) {
    return NextResponse.json({ error: "E-mail ou senha incorretos" }, { status: 401 });
  }

  if (!usuario.senha_hash) {
    return NextResponse.json(
      { error: "Você ainda não definiu uma senha. Use 'Esqueci minha senha'." },
      { status: 401 }
    );
  }

  const ok = await bcrypt.compare(senha, usuario.senha_hash);
  if (!ok) {
    return NextResponse.json({ error: "E-mail ou senha incorretos" }, { status: 401 });
  }

  const session: Session = {
    id: usuario.id,
    email: usuario.email,
    nome: usuario.nome,
    role: usuario.role,
    unidade: usuario.unidade,
    tipo: usuario.tipo,
    marketing: usuario.marketing,
  };

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, signSession(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });

  return response;
}
