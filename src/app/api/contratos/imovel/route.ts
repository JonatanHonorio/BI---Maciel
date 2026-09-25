import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { podeEditarContrato, podeVerBanco } from "@/lib/contratos";
import { montarEndereco, parte, type ImovelEndereco } from "@/lib/imovel-endereco";

/**
 * Preenchimento do card pela referência do imóvel.
 *
 * Devolve endereço, ficha do imóvel e os PROPRIETÁRIOS (o vendedor/locador),
 * com o dado civil que o contrato exige. A ref é digitada de vários jeitos
 * ("58298", "L58808", "V 58298"), mas o número é sempre o id do imóvel —
 * `imoveis.codigo` está gravado como "0" na maior parte da base.
 *
 * Só quem opera o quadro chama isto: é consulta de CPF/RG/conta bancária por
 * referência, não pode ficar aberta a qualquer sessão logada.
 */
interface ClienteRow {
  id: number; nome: string | null; cpf: string | null; rg: string | null;
  rg_emissor: string | null; data_nascimento: string | null;
  nacionalidade: string | null; profissao: string | null; estado_civil: string | null;
  email: string | null; celular: string | null; telefone: string | null;
  endereco: string | null; numero: string | null; complemento: string | null;
  bairro: string | null; cidade: string | null; estado: string | null; cep: string | null;
  banco: string | null; agencia: string | null; conta: string | null;
  percentual: string | null;
}

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!podeEditarContrato(session)) {
    return NextResponse.json({ error: "sem acesso" }, { status: 403 });
  }

  const ref = req.nextUrl.searchParams.get("ref") || "";
  const id = Number(ref.replace(/\D/g, ""));
  if (!id) return NextResponse.json({ error: "ref inválida" }, { status: 400 });

  const sql = getDb();
  const [imovel] = await sql`
    SELECT id, endereco, numero, complemento, compl_blocos, unidade_imovel,
           quadra, lote, bairro, cidade, estado, cep, tipo_imovel, dormitorios,
           suites, banheiros, area_util, area_total, valor, valor_locacao,
           edificio_id
    FROM imoveis WHERE id = ${id}
  `;
  if (!imovel) return NextResponse.json({ error: "imóvel não encontrado" }, { status: 404 });

  const proprietarios = (await sql`
    SELECT cl.id, cl.nome, cl.cpf, cl.rg, cl.rg_emissor, cl.data_nascimento,
           cl.nacionalidade, cl.profissao, ec.nome AS estado_civil,
           cl.email, cl.celular, cl.telefone,
           cl.endereco, cl.numero, cl.complemento, cl.bairro, cl.cidade, cl.estado, cl.cep,
           cl.banco, cl.agencia, cl.conta, p.percentual
    FROM imovel_proprietarios p
    JOIN clientes cl ON cl.id = p.cliente_id
    LEFT JOIN estados_civis ec ON ec.id = cl.estado_civil_id
    WHERE p.imovel_id = ${id}
    ORDER BY p.percentual DESC NULLS LAST, cl.nome
  `) as ClienteRow[];

  const verBanco = podeVerBanco(session);
  const [edificio] = imovel.edificio_id
    ? await sql`SELECT nome FROM empreendimentos WHERE id = ${imovel.edificio_id}`
    : [undefined];

  return NextResponse.json({
    imovel_id: imovel.id,
    endereco: montarEndereco(imovel as unknown as ImovelEndereco),
    imovel_dados: {
      tipo: parte(imovel.tipo_imovel as string),
      empreendimento: edificio?.nome ?? null,
      bairro: parte(imovel.bairro as string),
      cidade: parte(imovel.cidade as string),
      estado: parte(imovel.estado as string),
      cep: parte(imovel.cep as string),
      dormitorios: Number(imovel.dormitorios) || null,
      suites: Number(imovel.suites) || null,
      banheiros: Number(imovel.banheiros) || null,
      area_util: Number(imovel.area_util) || null,
      area_total: Number(imovel.area_total) || null,
      valor: Number(imovel.valor) || null,
      valor_locacao: Number(imovel.valor_locacao) || null,
    },
    // Cada proprietário vira uma linha do bloco "vendedor". Imóvel de casal
    // volta com dois, e o percentual de cada um vem junto.
    vendedor: proprietarios.map((p) => ({
      cliente_id: p.id,
      nome: p.nome ?? "",
      cpf: parte(p.cpf), rg: parte(p.rg), rg_emissor: parte(p.rg_emissor),
      data_nascimento: p.data_nascimento ?? null,
      nacionalidade: parte(p.nacionalidade), profissao: parte(p.profissao),
      estado_civil: p.estado_civil ?? "",
      email: parte(p.email), celular: parte(p.celular), telefone: parte(p.telefone),
      endereco: [parte(p.endereco), parte(p.numero), parte(p.complemento)].filter(Boolean).join(", "),
      bairro: parte(p.bairro), cidade: parte(p.cidade), estado: parte(p.estado), cep: parte(p.cep),
      percentual: p.percentual != null ? Number(p.percentual) : null,
    })),
    // O bloco bancário vem separado do vendedor para poder ser omitido inteiro
    // de quem não pode vê-lo, sem mexer no resto da ficha.
    banco: verBanco
      ? proprietarios
          .filter((p) => parte(p.banco) || parte(p.agencia) || parte(p.conta))
          .map((p) => ({
            cliente_id: p.id, titular: p.nome ?? "",
            banco: parte(p.banco), agencia: parte(p.agencia), conta: parte(p.conta),
          }))
      : null,
    sem_proprietario: proprietarios.length === 0,
  });
}
