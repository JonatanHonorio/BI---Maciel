import jwt from "jsonwebtoken";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import type { Tipo } from "./unidade";

/**
 * `gerente_adm` = gerente administrativa: só fechamento e comissões, nas duas
 * verticais da própria unidade. Precisa ser uma string diferente de "gerente"
 * — o predicado de "ver como" é `role === "gerente" && unidade === null`, e
 * com a role de gerente elas ganhariam "ver como" de diretora sem querer.
 *
 * `contratos` = setor de contratos (a Ana, 25/09/2026): só o Kanban de
 * contratos, em todas as unidades e nas duas verticais. Pelo mesmo motivo
 * acima não pode ser "gerente" sem unidade, que daria "ver como" a ela.
 */
export type Role = "admin" | "gerente" | "gerente_adm" | "contratos";

export interface Session {
  id: number;
  email: string;
  nome: string;
  role: Role;
  unidade: string | null;
  /**
   * Unidades extras de quem cobre mais de uma (a adm da Urbanova cobre também
   * Diretoria e Lançamento). Opcional porque cookie assinado antes deste
   * deploy não tem o campo — nesse caso vale só `unidade`, que erra pra menos,
   * nunca pra mais. Mexeu nas unidades de alguém no banco? A pessoa precisa
   * sair e entrar de novo: o JWT não é reconsultado a cada request.
   */
  unidades?: string[] | null;
  tipo: Tipo | null;
  marketing: boolean;
  /**
   * Preenchido só quando um admin está "vendo como" um gerente — nesse caso
   * role/unidade/tipo/marketing acima JÁ são os do gerente (é assim que o
   * resto do app, sem saber de nada disso, escopa os dados certo sozinho).
   * Isto aqui só serve pra UI saber quem é de verdade e mostrar o aviso.
   */
  verComo?: { nome: string; unidade: string | null; tipo: Tipo | null } | null;
}

interface ViewAsPayload {
  nome: string;
  unidade: string | null;
  tipo: Tipo | null;
  marketing: boolean;
}

export const SESSION_COOKIE = "bi_session";
export const VIEW_AS_COOKIE = "bi_ver_como";
const EXPIRES_IN = "7d";
// Curto de propósito: é pra análise pontual com o gerente, não uma troca
// permanente de perfil — some sozinho se esquecerem de sair.
const VIEW_AS_EXPIRES_IN = "8h";

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET não configurado");
  return s;
}

export function signSession(session: Session): string {
  return jwt.sign(session, secret(), { expiresIn: EXPIRES_IN });
}

export function signViewAs(payload: ViewAsPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: VIEW_AS_EXPIRES_IN });
}

function verify<T>(token: string | undefined): T | null {
  if (!token) return null;
  try {
    return jwt.verify(token, secret()) as unknown as T;
  } catch {
    return null;
  }
}

function montarSessao(realToken: string | undefined, viewAsToken: string | undefined): Session | null {
  const real = verify<Session>(realToken);
  if (!real) return null;
  // Só admin ou "diretora" (gerente sem unidade fixa — hoje só a Daniela)
  // pode "ver como". Cookie de um gerente comum, ou de uma sessão já
  // rebaixada por outra "ver como", é ignorado.
  const podeVerComo = real.role === "admin" || (real.role === "gerente" && real.unidade === null);
  if (!podeVerComo) return { ...real, verComo: null };

  const viewAs = verify<ViewAsPayload>(viewAsToken);
  if (!viewAs) return { ...real, verComo: null };

  return {
    id: real.id,
    email: real.email,
    nome: real.nome,
    role: "gerente",
    unidade: viewAs.unidade,
    tipo: viewAs.tipo,
    marketing: viewAs.marketing,
    verComo: { nome: viewAs.nome, unidade: viewAs.unidade, tipo: viewAs.tipo },
  };
}

/** Sessão real, ignorando "ver como" — só pra autorizar entrar/sair do modo. */
export function getSessaoReal(req: NextRequest): Session | null {
  return verify<Session>(req.cookies.get(SESSION_COOKIE)?.value);
}

/** Route Handlers (`req.cookies`). Já aplica o "ver como" quando presente. */
export function getSession(req: NextRequest): Session | null {
  return montarSessao(req.cookies.get(SESSION_COOKIE)?.value, req.cookies.get(VIEW_AS_COOKIE)?.value);
}

/** Server Components / layouts (`next/headers`). Idem. */
export async function getSessionFromCookies(): Promise<Session | null> {
  const store = await cookies();
  return montarSessao(store.get(SESSION_COOKIE)?.value, store.get(VIEW_AS_COOKIE)?.value);
}
