import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessaoReal, signViewAs, VIEW_AS_COOKIE, type Session } from "@/lib/auth";
import { rotaInicial } from "@/lib/permissoes";

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
      ? // Admin vê também as gerentes administrativas (pedido do Jonatan em
        // 25/09/2026): sem isso, ele, a Tatiane e a Pietra não conseguiam
        // conferir a tela de fechamento como ela é vista por quem a preenche.
        // `role` vai junto pra tela rotular e pro POST saber o que assinar.
        await sql`
          SELECT id, nome, unidade, unidades, tipo, role
          FROM usuarios_bi
          WHERE role IN ('gerente', 'gerente_adm') AND ativo = true
          ORDER BY role, unidade NULLS FIRST, tipo, nome`
      : // Diretora: só as unidades do próprio tipo (unidade preenchida, nunca
        // outra diretora, nunca administrativo — ela não lança fechamento).
        await sql`
          SELECT id, nome, unidade, unidades, tipo, role
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
  // A lista de papéis aceitos fica no SQL: alvo fora dela nem é encontrado, e
  // por isso não há caminho para assinar um cookie de "ver como admin".
  const [alvo] = await sql`
    SELECT nome, unidade, unidades, tipo, marketing, role FROM usuarios_bi
    WHERE id = ${userId} AND role IN ('gerente', 'gerente_adm') AND ativo = true`;
  if (!alvo) {
    return NextResponse.json({ error: "gerente não encontrado" }, { status: 404 });
  }

  // Defesa extra: diretora não escolhe fora do próprio tipo/unidade nula, nem
  // vira administrativo, mesmo montando a chamada na mão fora da lista.
  if (real.role !== "admin" && (alvo.role !== "gerente" || alvo.unidade === null || alvo.tipo !== real.tipo)) {
    return NextResponse.json({ error: "fora do seu escopo" }, { status: 403 });
  }

  const simulado = {
    role: alvo.role as "gerente" | "gerente_adm",
    unidade: alvo.unidade as string | null,
    unidades: (alvo.unidades ?? null) as string[] | null,
    tipo: alvo.tipo,
    marketing: alvo.marketing,
  };

  // O destino vai na resposta porque depende do papel simulado: a adm não pode
  // ver o /resumo, e mandá-la pra lá só pra o proxy redirecionar deixaria um
  // salto visível na tela.
  const response = NextResponse.json({ ok: true, destino: rotaInicial({ ...simulado, id: 0, email: "", nome: alvo.nome }) });
  response.cookies.set(
    VIEW_AS_COOKIE,
    signViewAs({ nome: alvo.nome, ...simulado }),
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
