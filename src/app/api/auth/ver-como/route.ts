import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessaoReal, signViewAs, VIEW_AS_COOKIE, type Session } from "@/lib/auth";

/**
 * Quem pode "ver como": admin (todo mundo) e "diretora" — gerente sem
 * unidade fixa (hoje só a Daniela, Diretora de Vendas: unidade NULL,
 * tipo 'venda') — mas essa só pode ver as unidades do PRÓPRIO tipo, nunca
 * trocar pra locação nem virar outra diretora.
 */
function podeVerComo(real: Session | null): real is Session {
  return !!real && (real.role === "admin" || (real.role === "gerente" && real.unidade === null));
}

/** Lista de gerentes pro seletor (checa a sessão REAL, não a "vendo como"). */
export async function GET(req: NextRequest) {
  const real = getSessaoReal(req);
  if (!podeVerComo(real)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sql = getDb();
  const gerentes =
    real.role === "admin"
      ? await sql`
          SELECT id, nome, unidade, tipo
          FROM usuarios_bi
          WHERE role = 'gerente' AND ativo = true
          ORDER BY unidade NULLS FIRST, tipo, nome`
      : // Diretora: só as unidades do próprio tipo (unidade preenchida, nunca outra diretora).
        await sql`
          SELECT id, nome, unidade, tipo
          FROM usuarios_bi
          WHERE role = 'gerente' AND ativo = true AND unidade IS NOT NULL AND tipo = ${real.tipo}
          ORDER BY unidade, nome`;
  return NextResponse.json(gerentes);
}

/** Ativa "ver como" — precisa da sessão REAL (admin ou diretora), nunca de uma "ver como" já ativa. */
export async function POST(req: NextRequest) {
  const real = getSessaoReal(req);
  if (!podeVerComo(real)) {
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

  // Defesa extra: diretora não escolhe fora do próprio tipo/unidade nula,
  // mesmo que alguém monte a chamada na mão fora da lista que a tela mostra.
  if (real.role !== "admin" && (alvo.unidade === null || alvo.tipo !== real.tipo)) {
    return NextResponse.json({ error: "fora do seu escopo" }, { status: 403 });
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

/** Sai do "ver como", volta pra visão normal (admin ou diretora). */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(VIEW_AS_COOKIE);
  return response;
}
