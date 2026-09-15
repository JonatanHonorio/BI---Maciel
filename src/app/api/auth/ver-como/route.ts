import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessaoReal, signViewAs, VIEW_AS_COOKIE } from "@/lib/auth";

/** Lista de gerentes pro seletor — só admin (checa a sessão REAL, não a "vendo como"). */
export async function GET(req: NextRequest) {
  const real = getSessaoReal(req);
  if (!real || real.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sql = getDb();
  const gerentes = await sql`
    SELECT id, nome, unidade, tipo
    FROM usuarios_bi
    WHERE role = 'gerente' AND ativo = true
    ORDER BY unidade NULLS FIRST, tipo, nome`;
  return NextResponse.json(gerentes);
}

/** Ativa "ver como" — precisa da sessão REAL admin, nunca de uma "ver como" já ativa. */
export async function POST(req: NextRequest) {
  const real = getSessaoReal(req);
  if (!real || real.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { userId } = await req.json();
  const sql = getDb();
  const [alvo] = await sql`
    SELECT nome, unidade, tipo, marketing FROM usuarios_bi
    WHERE id = ${userId} AND role = 'gerente' AND ativo = true`;
  if (!alvo) {
    return NextResponse.json({ error: "gerente não encontrado" }, { status: 404 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    VIEW_AS_COOKIE,
    signViewAs({ nome: alvo.nome, unidade: alvo.unidade, tipo: alvo.tipo, marketing: alvo.marketing }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 8,
      path: "/",
    }
  );
  return response;
}

/** Sai do "ver como", volta pra visão normal do admin. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(VIEW_AS_COOKIE);
  return response;
}
