"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { Plus, Send, Download, Lock, Unlock, Ban } from "lucide-react";
import DataTable from "@/components/DataTable";
import FechamentoForm from "@/components/FechamentoForm";
import { fmtMoney } from "@/lib/format";

// corretor_id vem nulo quando a linha foi gravada com nome digitado (pessoa
// fora do cadastro do Kurole) — o `nome` já chega resolvido pela API.
type Rateio = { corretor_id: number | null; nome: string; papel: "levantamento" | "fechamento"; percentual: number | null };
type Negocio = {
  id: number; data_contrato: string | null; ref: string | null; contrato: string | null;
  endereco: string | null; origem: string | null; valor: number | null; comissao: number | null;
  pagamento: string | null; observacao: string | null; comissao_paga: boolean; rateio: Rateio[];
  /** Venda cancelada/distratada: a linha fica, os valores saem das contas. */
  cancelado: boolean; cancelado_motivo: string | null;
  /** Só vêm no consolidado, onde a lista mistura unidades e meses. */
  unidade?: string;
  competencia?: string;
};
type Periodo = { id: number; competencia: string; unidade: string; tipo: "venda" | "locacao"; status: "aberto" | "enviado" };
/** Leitura sem período: mais de uma unidade, mais de um mês, ou os dois. */
type Consolidado = {
  de: string; ate: string; tipo: "venda" | "locacao"; unidade: string | null;
  periodos: { competencia: string; unidade: string; status: "aberto" | "enviado" }[];
};
type Permissoes = {
  unidades: string[];
  escolheUnidade: boolean;
  escolheTipo: boolean;
  podeReabrir: boolean;
  podeComissoes: boolean;
};
type Resposta = {
  session: { role: "admin" | "gerente" | "gerente_adm"; unidade: string | null; tipo: "venda" | "locacao" | null; nome: string };
  permissoes: Permissoes;
  unidades: readonly string[];
  periodo: Periodo | null;
  consolidado?: Consolidado | null;
  /** Gerente da unidade/vertical — o formulário usa pra preencher a Gerência. */
  gerente: { id: number; nome: string } | null;
  negocios: Negocio[];
};

/** Valor do seletor que pede o mês inteiro. Combina com a API. */
const TODAS_AS_UNIDADES = "__todas";

const nomesPapel = (rateio: Rateio[], papel: string) =>
  rateio.filter((r) => r.papel === papel).map((r) => r.nome).join(", ") || "—";

// DATE vem como "YYYY-MM-DD..." — new Date() trataria como UTC e mostraria 1 dia antes no fuso do Brasil.
const fmtDataISO = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

/** Agrupa os períodos por mês, pra faixa longa não virar 80 etiquetas. */
function resumoPorMes(periodos: Consolidado["periodos"]) {
  const por = new Map<string, { competencia: string; unidades: number; enviadas: number }>();
  for (const p of periodos) {
    const atual = por.get(p.competencia) ?? { competencia: p.competencia, unidades: 0, enviadas: 0 };
    atual.unidades += 1;
    if (p.status === "enviado") atual.enviadas += 1;
    por.set(p.competencia, atual);
  }
  return [...por.values()].sort((a, b) => a.competencia.localeCompare(b.competencia));
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * "2025-12-01" -> "dezembro de 2025".
 *
 * Pela mesma razão de `fmtDataISO`, e não é detalhe: a competência é sempre
 * dia 1, que `new Date()` lê como meia-noite UTC — 21h do dia anterior no
 * Brasil. O cabeçalho anunciava NOVEMBRO enquanto o seletor mostrava dezembro
 * e a tela listava os negócios de dezembro.
 */
const mesAno = (iso: string) => {
  const [y, m] = iso.slice(0, 10).split("-");
  return `${MESES[Number(m) - 1]} de ${y}`;
};

// Duplicada (não importa de @/lib/fechamento): esse arquivo puxa unidade.ts,
// que usa fs/path — incompatível com client component.
function competenciaAtualISO() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function FechamentoPage() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [corretores, setCorretores] = useState<{ id: number; nome: string }[]>([]);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [unidadeSel, setUnidadeSel] = useState("");
  const [tipoSel, setTipoSel] = useState<"venda" | "locacao" | "">("");
  // Faixa de competências, igual à tela de Comissões. Abre no mês corrente,
  // que é o uso do dia a dia; faixa de mais de um mês vira leitura, porque um
  // período é sempre de um mês só.
  const [de, setDe] = useState(competenciaAtualISO());
  const [ate, setAte] = useState(competenciaAtualISO());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [confirmarEnvio, setConfirmarEnvio] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState<number | null>(null);
  const [linhaAberta, setLinhaAberta] = useState<number | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
  const [correcao, setCorrecao] = useState<{ valor: string; comissao: string } | null>(null);

  // Trocar de mês/unidade rápido dispara mais de uma busca ao mesmo tempo, e
  // elas não voltam necessariamente na ordem em que saíram — uma resposta
  // antiga chegando depois sobrescrevia a nova, deixando a tela mostrando um
  // mês e o seletor outro. Cada busca leva um número e só a última manda.
  const buscaAtual = useRef(0);

  // Sem o try/catch, uma resposta de erro (ex: timeout do banco, que devolve
  // corpo vazio) estourava no r.json() e a tela ficava com os dados do mês
  // anterior na tela, sem avisar nada.
  // Só manda o que a pessoa pode escolher: quem tem uma opção só (o gerente,
  // e a adm de unidade única) é resolvido pelo servidor.
  const carregar = useCallback(async () => {
    const minhaBusca = ++buscaAtual.current;
    setCarregando(true);
    setErro("");
    const permissoes = dados?.permissoes;
    const params = new URLSearchParams({ de, ate });
    if (permissoes?.escolheUnidade && unidadeSel) params.set("unidade", unidadeSel);
    if (permissoes?.escolheTipo && tipoSel) params.set("tipo", tipoSel);
    try {
      const r = await fetch(`/api/fechamento?${params}`);
      if (minhaBusca !== buscaAtual.current) return;
      if (!r.ok) throw new Error();
      const j = (await r.json()) as Resposta;
      if (minhaBusca !== buscaAtual.current) return;
      setDados(j);
    } catch {
      if (minhaBusca !== buscaAtual.current) return;
      setErro("Não foi possível carregar o fechamento. Tente de novo.");
    } finally {
      if (minhaBusca === buscaAtual.current) setCarregando(false);
    }
  }, [dados?.permissoes, unidadeSel, tipoSel, de, ate]);

  // Um efeito só: a adm de unidade única não tem seletor de unidade, então
  // esperar por unidadeSel deixaria a tela sem recarregar ao trocar a vertical.
  useEffect(() => { carregar(); }, [de, ate, unidadeSel, tipoSel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lista de corretores é a mesma pra todo mundo — busca uma vez.
  useEffect(() => {
    fetch("/api/fechamento/corretores")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCorretores)
      .catch(() => setCorretores([]));
  }, []);

  /** Mostra o erro da API (403 de outra unidade, 409 de período travado) em vez de falhar calado. */
  async function chamar(url: string, init: RequestInit, aoDarCerto: () => void) {
    setErro("");
    try {
      const r = await fetch(url, init);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error);
      }
      aoDarCerto();
      carregar();
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : "Não foi possível concluir. Tente de novo.");
    }
  }

  async function enviar() {
    if (!dados?.periodo) return;
    await chamar(
      "/api/fechamento/enviar",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ periodo_id: dados.periodo.id }) },
      () => setConfirmarEnvio(false)
    );
  }

  async function reabrir() {
    if (!dados?.periodo) return;
    await chamar(
      "/api/fechamento/reabrir",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ periodo_id: dados.periodo.id }) },
      () => {}
    );
  }

  async function excluir(negocioId: number) {
    await chamar(`/api/fechamento/negocios/${negocioId}`, { method: "DELETE" }, () => setConfirmarExclusao(null));
  }

  /**
   * Cancela (ou reativa) uma venda. Não passa pelo DELETE: o registro fica, só
   * os valores saem das contas. Funciona com o mês já enviado de propósito —
   * distrato quase sempre chega depois do fechamento.
   */
  /**
   * Corrige valor e comissão sem passar pelo PUT do negócio, que reescreve o
   * rateio e — por causa do CASCADE — apagaria as baixas já lançadas.
   *
   * Como o rateio é percentual, subir a comissão sobe sozinho o quanto cada um
   * tem a receber; quem já recebeu fica com o que recebeu e a diferença vira
   * saldo.
   */
  async function salvarCorrecao(negocioId: number) {
    if (!correcao) return;
    await chamar(
      `/api/fechamento/negocios/${negocioId}/valores`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          valor: correcao.valor === "" ? null : Number(correcao.valor),
          comissao: correcao.comissao === "" ? null : Number(correcao.comissao),
        }),
      },
      () => setCorrecao(null)
    );
  }

  async function alternarCancelamento(negocioId: number, cancelar: boolean) {
    await chamar(
      `/api/fechamento/negocios/${negocioId}/cancelar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelado: cancelar, motivo: motivoCancelamento }),
      },
      () => {
        setLinhaAberta(null);
        setMotivoCancelamento("");
      }
    );
  }

  if (carregando && !dados) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }
  // Falhou já na primeira carga: sem isso a tela ficava em branco, sem explicação.
  if (!dados) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
        {erro || "Não foi possível carregar o fechamento."}{" "}
        <button onClick={carregar} className="font-medium underline hover:no-underline">Tentar de novo</button>
      </div>
    );
  }

  const permissoes = dados.permissoes;
  const periodo = dados.periodo;
  const consolidado = dados.consolidado ?? null;
  const travado = periodo?.status === "enviado";
  // Venda cancelada não entra em nenhum total — é o ponto do cancelamento.
  const valendo = dados.negocios.filter((n) => !n.cancelado);
  const canceladas = dados.negocios.length - valendo.length;
  const totalValor = valendo.reduce((s, n) => s + (n.valor ? Number(n.valor) : 0), 0);
  const totalComissao = valendo.reduce((s, n) => s + (n.comissao ? Number(n.comissao) : 0), 0);

  /**
   * Linhas da tabela. O cancelamento é resolvido AQUI, e não na coluna: o
   * `format` do DataTable recebe só o valor da célula, sem a linha, então não
   * há como uma coluna saber que o negócio ao lado foi cancelado.
   */
  const linhasTabela = (lista: Negocio[]) =>
    lista.map((n) => ({
      ...n,
      contrato: n.contrato || "—",
      situacao: n.cancelado ? "Cancelada" : "",
      valor: n.cancelado ? null : n.valor,
      comissao: n.cancelado ? null : n.comissao,
      levantamento: nomesPapel(n.rateio, "levantamento"),
      fechamento: nomesPapel(n.rateio, "fechamento"),
    }));

  /**
   * Painel que abre ao clicar na linha do negócio.
   *
   * Substitui a lista de "cancelar #id" que ficava embaixo da tabela: com 320
   * negócios na visão consolidada aquilo virava um paredão de links, e não
   * dava para saber qual fechamento cada número era (26/09). Aqui a ação está
   * na própria linha, como na tela de comissões.
   */
  const painelDaLinha = (row: Record<string, unknown>) => {
    const id = Number(row.id);
    if (linhaAberta !== id) return null;
    const n = dados.negocios.find((x) => x.id === id);
    if (!n) return null;

    if (!permissoes.podeComissoes) {
      return <p className="text-xs text-gray-400">Sem permissão para cancelar neste negócio.</p>;
    }

    return (
      <div className="space-y-2">
        <p className="text-xs text-gray-600">
          <span className="text-gray-400">#{n.id}</span> {n.ref ? `Ref ${n.ref}` : "sem ref"}
          {n.contrato ? ` · Contrato ${n.contrato}` : ""}
          {n.endereco ? ` · ${n.endereco}` : ""}
        </p>

        {correcao ? (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-gray-500">Valor</label>
              <input
                value={correcao.valor}
                onChange={(e) => setCorrecao({ ...correcao, valor: e.target.value })}
                inputMode="decimal"
                className="w-36 rounded border border-gray-300 px-2 py-1.5 text-xs tabular-nums"
              />
            </div>
            {n.comissao !== null && (
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-gray-500">Comissão</label>
                <input
                  value={correcao.comissao}
                  onChange={(e) => setCorrecao({ ...correcao, comissao: e.target.value })}
                  inputMode="decimal"
                  className="w-36 rounded border border-gray-300 px-2 py-1.5 text-xs tabular-nums"
                />
              </div>
            )}
            <button
              onClick={() => salvarCorrecao(n.id)}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Salvar
            </button>
            <button onClick={() => setCorrecao(null)} className="px-2 py-1.5 text-xs text-gray-500 hover:underline">
              Cancelar
            </button>
            <span className="text-[11px] text-gray-400">
              o rateio é percentual: o que cada um tem a receber acompanha
            </span>
          </div>
        ) : n.cancelado ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              Cancelada{n.cancelado_motivo ? ` — ${n.cancelado_motivo}` : ""}
            </span>
            <button
              onClick={() => alternarCancelamento(n.id, false)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-white"
            >
              Reativar venda
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={motivoCancelamento}
              onChange={(e) => setMotivoCancelamento(e.target.value)}
              placeholder="motivo do cancelamento (opcional)"
              className="w-72 rounded border border-gray-300 px-2 py-1.5 text-xs"
            />
            <button
              onClick={() => alternarCancelamento(n.id, true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              <Ban size={13} /> Cancelar venda
            </button>
            <button
              onClick={() =>
                setCorrecao({
                  valor: n.valor == null ? "" : String(n.valor),
                  comissao: n.comissao == null ? "" : String(n.comissao),
                })
              }
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Corrigir valor/comissão
            </button>
            <span className="text-[11px] text-gray-400">
              cancelar mantém o registro e tira os valores dos totais
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Fechamento mensal</h2>
          {periodo && (
            <p className="text-sm text-gray-500">
              {periodo.unidade} · {periodo.tipo === "venda" ? "Vendas" : "Locação"} ·{" "}
              {mesAno(periodo.competencia)}
              {" — "}
              <span className={travado ? "font-medium text-amber-600" : "font-medium text-emerald-600"}>
                {travado ? "Enviado" : "Em aberto"}
              </span>
            </p>
          )}
          {consolidado && (
            <p className="text-sm text-gray-500">
              {consolidado.unidade && consolidado.unidade !== TODAS_AS_UNIDADES
                ? consolidado.unidade
                : "Todas as unidades"}{" "}
              · {consolidado.tipo === "venda" ? "Vendas" : "Locação"} ·{" "}
              {consolidado.de === consolidado.ate
                ? mesAno(consolidado.de)
                : `${mesAno(consolidado.de)} a ${mesAno(consolidado.ate)}`}
              {" — "}<span className="font-medium text-gray-600">somente leitura</span>
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <label className="flex items-center gap-1.5 text-sm text-gray-500">
            De
            <input
              type="month"
              value={de.slice(0, 7)}
              onChange={(e) => {
                const novo = `${e.target.value}-01`;
                setDe(novo);
                // Início depois do fim devolve lista vazia sem explicar por quê.
                if (novo > ate) setAte(novo);
              }}
              className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-500">
            até
            <input
              type="month"
              value={ate.slice(0, 7)}
              onChange={(e) => {
                const novo = `${e.target.value}-01`;
                setAte(novo);
                if (novo < de) setDe(novo);
              }}
              className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
            />
          </label>
          {permissoes.escolheUnidade && (
            <select value={unidadeSel} onChange={(e) => setUnidadeSel(e.target.value)} className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm">
              <option value="">Unidade...</option>
              <option value={TODAS_AS_UNIDADES}>Todas as unidades</option>
              {dados.unidades.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          )}
          {permissoes.escolheTipo && (
            <select value={tipoSel} onChange={(e) => setTipoSel(e.target.value as "venda" | "locacao" | "")} className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm">
              <option value="">Tipo...</option>
              <option value="venda">Vendas</option>
              <option value="locacao">Locação</option>
            </select>
          )}
        </div>
      </div>

      {erro && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {erro}
          <button onClick={carregar} className="font-medium underline hover:no-underline">Tentar de novo</button>
        </div>
      )}

      {!periodo && !consolidado && (permissoes.escolheUnidade || permissoes.escolheTipo) && (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          {permissoes.escolheUnidade
            ? "Escolha unidade e tipo acima pra abrir o fechamento do mês."
            : "Escolha o tipo (Vendas ou Locação) acima pra abrir o fechamento do mês."}
        </div>
      )}

      {consolidado && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex gap-6 text-sm">
              <span>
                <span className="text-gray-500">Negócios: </span>
                <span className="font-semibold">{valendo.length}</span>
                {canceladas > 0 && (
                  <span className="text-gray-400"> · {canceladas} cancelada{canceladas > 1 ? "s" : ""}</span>
                )}
              </span>
              <span><span className="text-gray-500">Total: </span><span className="font-semibold">{fmtMoney(totalValor)}</span></span>
              {consolidado.tipo === "venda" && (
                <span><span className="text-gray-500">Comissão: </span><span className="font-semibold">{fmtMoney(totalComissao)}</span></span>
              )}
            </div>
            <a
              href={`/api/fechamento/exportar?de=${consolidado.de}&ate=${consolidado.ate}&tipo=${consolidado.tipo}${consolidado.unidade ? `&unidade=${encodeURIComponent(consolidado.unidade)}` : ""}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Download size={14} /> Excel
            </a>

            {/* Quais unidades já fecharam. Sem isso, um total baixo parece erro
                quando na verdade é unidade que ainda não lançou.
                Numa faixa de vários meses seriam 8 unidades × N meses de
                etiqueta — aí vira um resumo por mês. */}
            <div className="flex flex-wrap gap-1.5">
              {consolidado.periodos.length === 0 && (
                <span className="text-xs text-gray-400">Nenhuma unidade abriu o período ainda.</span>
              )}
              {consolidado.de === consolidado.ate
                ? consolidado.periodos.map((p) => (
                    <span
                      key={p.unidade}
                      className={
                        "rounded-full px-2 py-0.5 text-xs " +
                        (p.status === "enviado" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")
                      }
                      title={p.status === "enviado" ? "Fechamento enviado" : "Ainda em aberto"}
                    >
                      {p.unidade}
                    </span>
                  ))
                : resumoPorMes(consolidado.periodos).map((m) => (
                    <span key={m.competencia} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {m.competencia.split("-").reverse().join("/")}: {m.unidades} un.
                      {m.enviadas > 0 && <span className="text-amber-700"> · {m.enviadas} enviada{m.enviadas > 1 ? "s" : ""}</span>}
                    </span>
                  ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <DataTable
              searchable
              columns={[
                { key: "data_contrato", label: "Data", format: (v) => (v ? fmtDataISO(v as string) : "—") },
                // Com faixa de um mês só, a competência é o próprio cabeçalho.
                ...(consolidado.de !== consolidado.ate
                  ? [{
                      key: "competencia", label: "Competência",
                      format: (v: unknown) => String(v ?? "").slice(0, 7).split("-").reverse().join("/"),
                    }]
                  : []),
                { key: "unidade", label: "Unidade" },
                { key: "ref", label: "Ref" },
                { key: "contrato", label: "Contrato" },
                { key: "endereco", label: "Endereço" },
                { key: "levantamento", label: "Levantamento" },
                { key: "fechamento", label: "Fechamento" },
                { key: "valor", label: "Valor", align: "right", format: (v) => (v ? fmtMoney(v as number) : "—") },
                ...(consolidado.tipo === "venda"
                  ? [{ key: "comissao", label: "Comissão", align: "right" as const, format: (v: unknown) => (v ? fmtMoney(v as number) : "—") }]
                  : []),
                { key: "origem", label: "Origem" },
                { key: "situacao", label: "Situação" },
              ]}
              data={linhasTabela(dados.negocios)}
              onRowClick={(row) => {
                const id = Number(row.id);
                setLinhaAberta(linhaAberta === id ? null : id);
                setMotivoCancelamento("");
                setCorrecao(null);
              }}
              linhaExpandida={painelDaLinha}
            />
            {/* Adicionar e Enviar continuam fora: as duas são do PERÍODO, que é
                sempre uma unidade + um mês. O Excel não — ele exporta o que
                está na tela, e a faixa consolidada é onde mais se quer isso. */}
            <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-400">
              Para lançar um negócio ou enviar o fechamento, escolha uma unidade no seletor acima.
            </p>
          </div>
        </>
      )}

      {periodo && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex gap-6 text-sm">
              <span>
                <span className="text-gray-500">Negócios: </span>
                <span className="font-semibold">{valendo.length}</span>
                {canceladas > 0 && (
                  <span className="text-gray-400"> · {canceladas} cancelada{canceladas > 1 ? "s" : ""}</span>
                )}
              </span>
              <span><span className="text-gray-500">Total: </span><span className="font-semibold">{fmtMoney(totalValor)}</span></span>
              {periodo.tipo === "venda" && (
                <span><span className="text-gray-500">Comissão: </span><span className="font-semibold">{fmtMoney(totalComissao)}</span></span>
              )}
            </div>
            <div className="flex gap-2">
              <a
                href={`/api/fechamento/exportar?periodo_id=${periodo.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Download size={14} /> Excel
              </a>
              {!travado && (
                <button onClick={() => setMostrarForm(true)} className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
                  <Plus size={14} /> Adicionar negócio
                </button>
              )}
              {!travado ? (
                confirmarEnvio ? (
                  <span className="inline-flex items-center gap-2 rounded-md bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
                    Confirma o envio? Depois só o admin edita.
                    <button onClick={enviar} className="font-semibold text-emerald-700 hover:underline">Sim</button>
                    <button onClick={() => setConfirmarEnvio(false)} className="text-gray-500 hover:underline">Não</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmarEnvio(true)} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
                    <Send size={14} /> Enviar fechamento
                  </button>
                )
              ) : permissoes.podeReabrir ? (
                <button onClick={reabrir} className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50">
                  <Unlock size={14} /> Reabrir
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-500">
                  <Lock size={14} /> Travado
                </span>
              )}
            </div>
          </div>

          {mostrarForm && (
            // `key` pelo período: sem ela o React reaproveita o formulário ao
            // trocar de unidade/tipo/mês e ele fica com o estado do período
            // anterior — a Gerência continuava preenchida com o gerente da
            // OUTRA vertical (Locação numa venda), e aqueles 10% da comissão
            // iriam pra pessoa errada sem nenhum aviso.
            <FechamentoForm
              key={periodo.id}
              periodoId={periodo.id}
              tipo={periodo.tipo}
              corretores={corretores}
              gerente={dados?.gerente ?? null}
              onSalvo={() => { setMostrarForm(false); carregar(); }}
              onCancelar={() => setMostrarForm(false)}
            />
          )}

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <DataTable
              searchable
              columns={[
                { key: "data_contrato", label: "Data", format: (v) => (v ? fmtDataISO(v as string) : "—") },
                { key: "ref", label: "Ref" },
                { key: "contrato", label: "Contrato" },
                { key: "endereco", label: "Endereço" },
                { key: "levantamento", label: "Levantamento" },
                { key: "fechamento", label: "Fechamento" },
                { key: "valor", label: "Valor", align: "right", format: (v) => (v ? fmtMoney(v as number) : "—") },
                ...(periodo.tipo === "venda"
                  ? [{ key: "comissao", label: "Comissão", align: "right" as const, format: (v: unknown) => (v ? fmtMoney(v as number) : "—") }]
                  : []),
                { key: "origem", label: "Origem" },
                { key: "situacao", label: "Situação" },
              ]}
              data={linhasTabela(dados.negocios)}
              onRowClick={(row) => {
                const id = Number(row.id);
                setLinhaAberta(linhaAberta === id ? null : id);
                setMotivoCancelamento("");
                setCorrecao(null);
              }}
              linhaExpandida={painelDaLinha}
            />
            {!travado && dados.negocios.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 pt-3">
                {dados.negocios.map((n) =>
                  confirmarExclusao === n.id ? (
                    <span key={n.id} className="inline-flex items-center gap-1.5 text-xs text-amber-700">
                      Excluir #{n.id}?
                      <button onClick={() => excluir(n.id)} className="font-semibold text-red-600 hover:underline">Sim</button>
                      <button onClick={() => setConfirmarExclusao(null)} className="text-gray-500 hover:underline">Não</button>
                    </span>
                  ) : (
                    <button
                      key={n.id}
                      onClick={() => setConfirmarExclusao(n.id)}
                      className="text-xs text-gray-400 hover:text-red-600 hover:underline"
                    >
                      excluir #{n.id} ({n.ref || n.endereco || "sem ref"})
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
