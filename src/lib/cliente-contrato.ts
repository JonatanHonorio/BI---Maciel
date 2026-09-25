import type { SQL } from "./db";
import { parte } from "./imovel-endereco";

/**
 * Ficha de cliente para o card de contrato.
 *
 * Serve os dois lados do negócio e por isso mora aqui, e não dentro de uma
 * rota: o VENDEDOR sai daqui via `imovel_proprietarios` (pela referência do
 * imóvel) e o COMPRADOR/LOCATÁRIO sai do mesmo lugar pelo id do cliente. Duas
 * cópias da montagem divergiriam no primeiro campo novo.
 */
export interface ClienteRow {
  id: number; nome: string | null; cpf: string | null; rg: string | null;
  rg_emissor: string | null; data_nascimento: string | null;
  nacionalidade: string | null; profissao: string | null; estado_civil: string | null;
  email: string | null; celular: string | null; telefone: string | null;
  endereco: string | null; numero: string | null; complemento: string | null;
  bairro: string | null; cidade: string | null; estado: string | null; cep: string | null;
  banco: string | null; agencia: string | null; conta: string | null;
  percentual?: string | null;
}

export function pessoaDoCliente(p: ClienteRow) {
  return {
    // `clientes.id` é bigint e o driver do Neon devolve string — sem o Number
    // a comparação que evita repetir a mesma pessoa no card falharia calada
    // quando um lado viesse do banco e o outro do formulário.
    cliente_id: Number(p.id),
    nome: p.nome ?? "",
    cpf: parte(p.cpf), rg: parte(p.rg), rg_emissor: parte(p.rg_emissor),
    data_nascimento: p.data_nascimento ?? null,
    nacionalidade: parte(p.nacionalidade), profissao: parte(p.profissao),
    estado_civil: p.estado_civil ?? "",
    email: parte(p.email), celular: parte(p.celular), telefone: parte(p.telefone),
    endereco: [parte(p.endereco), parte(p.numero), parte(p.complemento)].filter(Boolean).join(", "),
    bairro: parte(p.bairro), cidade: parte(p.cidade), estado: parte(p.estado), cep: parte(p.cep),
    percentual: p.percentual != null ? Number(p.percentual) : null,
  };
}

/** Conta bancária, separada da ficha porque nem todo mundo pode vê-la. */
export function contaDoCliente(p: ClienteRow) {
  return {
    cliente_id: Number(p.id), titular: p.nome ?? "",
    banco: parte(p.banco), agencia: parte(p.agencia), conta: parte(p.conta),
  };
}

export const temConta = (p: ClienteRow) => !!(parte(p.banco) || parte(p.agencia) || parte(p.conta));

/** Um cliente pelo id do Kurole — é o que preenche comprador/locatário. */
export async function clientePorId(sql: SQL, id: number): Promise<ClienteRow | null> {
  const [row] = (await sql`
    SELECT cl.id, cl.nome, cl.cpf, cl.rg, cl.rg_emissor, cl.data_nascimento,
           cl.nacionalidade, cl.profissao, ec.nome AS estado_civil,
           cl.email, cl.celular, cl.telefone,
           cl.endereco, cl.numero, cl.complemento, cl.bairro, cl.cidade, cl.estado, cl.cep,
           cl.banco, cl.agencia, cl.conta
    FROM clientes cl
    LEFT JOIN estados_civis ec ON ec.id = cl.estado_civil_id
    WHERE cl.id = ${id}
  `) as ClienteRow[];
  return row ?? null;
}

/** Proprietários de um imóvel, em ordem de participação. */
export async function proprietariosDoImovel(sql: SQL, imovelId: number): Promise<ClienteRow[]> {
  return (await sql`
    SELECT cl.id, cl.nome, cl.cpf, cl.rg, cl.rg_emissor, cl.data_nascimento,
           cl.nacionalidade, cl.profissao, ec.nome AS estado_civil,
           cl.email, cl.celular, cl.telefone,
           cl.endereco, cl.numero, cl.complemento, cl.bairro, cl.cidade, cl.estado, cl.cep,
           cl.banco, cl.agencia, cl.conta, p.percentual
    FROM imovel_proprietarios p
    JOIN clientes cl ON cl.id = p.cliente_id
    LEFT JOIN estados_civis ec ON ec.id = cl.estado_civil_id
    WHERE p.imovel_id = ${imovelId}
    ORDER BY p.percentual DESC NULLS LAST, cl.nome
  `) as ClienteRow[];
}
