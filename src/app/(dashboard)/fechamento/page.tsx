"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { Plus, Send, Download, Lock, Unlock } from "lucide-react";
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
};
type Periodo = { id: number; competencia: string; unidade: string; tipo: "venda" | "locacao"; status: "aberto" | "enviado" };
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
  negocios: Negocio[];
};

const nomesPapel = (rateio: Rateio[], papel: string) =>
  rateio.filter((r) => r.papel === papel).map((r) => r.nome).join(", ") || "—";

// DATE vem como "YYYY-MM-DD..." — new Date() trataria como UTC e mostraria 1 dia antes no fuso do Brasil.
const fmtDataISO = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
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
  const [competencia, setCompetencia] = useState(competenciaAtualISO());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [confirmarEnvio, setConfirmarEnvio] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState<number | null>(null);

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
    const params = new URLSearchParams({ competencia });
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
  }, [dados?.permissoes, unidadeSel, tipoSel, competencia]);

  // Um efeito só: a adm de unidade única não tem seletor de unidade, então
  // esperar por unidadeSel deixaria a tela sem recarregar ao trocar a vertical.
  useEffect(() => { carregar(); }, [competencia, unidadeSel, tipoSel]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const travado = periodo?.status === "enviado";
  const totalValor = dados.negocios.reduce((s, n) => s + (n.valor ? Number(n.valor) : 0), 0);
  const totalComissao = dados.negocios.reduce((s, n) => s + (n.comissao ? Number(n.comissao) : 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Fechamento mensal</h2>
          {periodo && (
            <p className="text-sm text-gray-500">
              {periodo.unidade} · {periodo.tipo === "venda" ? "Vendas" : "Locação"} ·{" "}
              {new Date(periodo.competencia).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
              {" — "}
              <span className={travado ? "font-medium text-amber-600" : "font-medium text-emerald-600"}>
                {travado ? "Enviado" : "Em aberto"}
              </span>
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="month"
            value={competencia.slice(0, 7)}
            onChange={(e) => setCompetencia(`${e.target.value}-01`)}
            className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm"
          />
          {permissoes.escolheUnidade && (
            <select value={unidadeSel} onChange={(e) => setUnidadeSel(e.target.value)} className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm">
              <option value="">Unidade...</option>
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

      {!periodo && (permissoes.escolheUnidade || permissoes.escolheTipo) && (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          {permissoes.escolheUnidade
            ? "Escolha unidade e tipo acima pra abrir o fechamento do mês."
            : "Escolha o tipo (Vendas ou Locação) acima pra abrir o fechamento do mês."}
        </div>
      )}

      {periodo && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex gap-6 text-sm">
              <span><span className="text-gray-500">Negócios: </span><span className="font-semibold">{dados.negocios.length}</span></span>
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
            <FechamentoForm
              periodoId={periodo.id}
              tipo={periodo.tipo}
              corretores={corretores}
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
                { key: "endereco", label: "Endereço" },
                { key: "levantamento", label: "Levantamento" },
                { key: "fechamento", label: "Fechamento" },
                { key: "valor", label: "Valor", align: "right", format: (v) => (v ? fmtMoney(v as number) : "—") },
                ...(periodo.tipo === "venda"
                  ? [{ key: "comissao", label: "Comissão", align: "right" as const, format: (v: unknown) => (v ? fmtMoney(v as number) : "—") }]
                  : []),
                { key: "origem", label: "Origem" },
              ]}
              data={dados.negocios.map((n) => ({
                ...n,
                levantamento: nomesPapel(n.rateio, "levantamento"),
                fechamento: nomesPapel(n.rateio, "fechamento"),
              }))}
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
