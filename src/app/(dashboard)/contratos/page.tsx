"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, ArrowRight, Undo2, MessageSquare, Loader2, Archive } from "lucide-react";
import ContratoForm, { CONTRATO_VAZIO, type ContratoEdicao, type Pessoa, type ContaBancaria } from "@/components/ContratoForm";
import { FASES, FASE_CONFERENCIA, FASE_PENDENCIA, nomeFase } from "@/lib/contratos";

type Contrato = {
  id: number; ref: string; imovel_id: number | null;
  tipo: "venda" | "locacao"; unidade: string;
  corretor_id: number | null; corretor_nome: string; fase: number;
  vendedor: Pessoa[]; comprador: Pessoa[];
  imovel_endereco: string | null; imovel_dados: Record<string, unknown>;
  banco: { contas?: ContaBancaria[] } | null; banco_oculto?: boolean;
  pagamento: string | null; observacao: string | null;
  arquivado: boolean; criado_em: string; atualizado_em: string;
};
type Evento = {
  id: number; de: number | null; para: number | null;
  comentario: string | null; criado_em: string; criado_por_nome: string;
};
type Permissoes = { editar: boolean; verBanco: boolean; unidades: string[] | null; tipos: string[] | null };

const CORES_FASE = [
  "bg-slate-100 text-slate-700", "bg-blue-100 text-blue-700", "bg-amber-100 text-amber-800",
  "bg-indigo-100 text-indigo-700", "bg-purple-100 text-purple-700",
  "bg-cyan-100 text-cyan-700", "bg-emerald-100 text-emerald-700",
];

const diaHora = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Dias parados na fase atual — é o que faz um contrato esquecido saltar aos olhos. */
const diasParado = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

function CartaoContrato({ c, onAbrir }: { c: Contrato; onAbrir: (c: Contrato) => void }) {
  const dias = diasParado(c.atualizado_em);
  return (
    <button
      onClick={() => onAbrir(c)}
      className="w-full text-left bg-white border border-gray-200 rounded-lg p-3 hover:border-blue-400 hover:shadow-sm transition"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-sm text-gray-800">{c.ref}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.tipo === "venda" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}>
          {c.tipo === "venda" ? "Venda" : "Locação"}
        </span>
      </div>
      {c.imovel_endereco && (
        <p className="text-xs text-gray-600 mt-1 line-clamp-2">{c.imovel_endereco}</p>
      )}
      <div className="flex items-center justify-between mt-2 text-[11px] text-gray-500">
        <span className="truncate">{c.corretor_nome || "—"}</span>
        <span className="shrink-0">{c.unidade}</span>
      </div>
      {dias >= 3 && (
        <p className={`text-[11px] mt-1.5 ${dias >= 7 ? "text-red-600" : "text-amber-600"}`}>
          parado há {dias} dias
        </p>
      )}
    </button>
  );
}

export default function ContratosPage() {
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [permissoes, setPermissoes] = useState<Permissoes | null>(null);
  const [todasUnidades, setTodasUnidades] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<Contrato | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [editando, setEditando] = useState<ContratoEdicao | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [comentario, setComentario] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  // Mesma trava de corrida das telas de fechamento: resposta antiga chegando
  // depois da nova pintava o mês errado (22/09/2026).
  const buscaAtual = useRef(0);

  const carregar = useCallback(async () => {
    const minhaBusca = ++buscaAtual.current;
    setCarregando(true);
    try {
      const rc = await fetch("/api/contratos");
      if (minhaBusca !== buscaAtual.current) return [];
      if (rc.ok) {
        const d = await rc.json();
        setContratos(d.contratos ?? []);
        setPermissoes(d.permissoes ?? null);
        setTodasUnidades(d.todasUnidades ?? []);
        return (d.contratos ?? []) as Contrato[];
      }
      return [];
    } finally {
      if (minhaBusca === buscaAtual.current) setCarregando(false);
    }
  }, []);

  const abrirCard = useCallback(async (c: Contrato) => {
    setAberto(c);
    setEditando(null);
    setComentario("");
    setErro(null);
    const r = await fetch(`/api/contratos/${c.id}`);
    if (r.ok) {
      const d = await r.json();
      setAberto(d.contrato);
      setEventos(d.eventos ?? []);
    }
  }, []);

  useEffect(() => {
    // O e-mail de aviso traz ?card=<id>: abrir direto nele poupa o gerente de
    // procurar o contrato no quadro. Fica junto da carga inicial, e não num
    // efeito próprio, pra não reabrir o painel a cada recarga da lista.
    carregar().then((lista) => {
      const id = Number(new URLSearchParams(window.location.search).get("card"));
      const achado = id ? lista.find((c) => c.id === id) : undefined;
      if (achado) abrirCard(achado);
    });
  }, [carregar, abrirCard]);


  const porFase = useMemo(() => {
    const mapa = new Map<number, Contrato[]>(FASES.map((f) => [f.id, []]));
    for (const c of contratos) mapa.get(c.fase)?.push(c);
    return mapa;
  }, [contratos]);

  async function salvarCard() {
    if (!editando) return;
    setSalvando(true);
    setErro(null);
    try {
      const novo = !editando.id;
      const r = await fetch(novo ? "/api/contratos" : `/api/contratos/${editando.id}`, {
        method: novo ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editando),
      });
      if (!r.ok) {
        setErro((await r.json().catch(() => ({}))).error ?? "não deu para salvar");
        return;
      }
      setEditando(null);
      setAberto(null);
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function mover(c: Contrato, fase: number, texto?: string) {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/contratos/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fase, comentario: texto || undefined }),
      });
      if (!r.ok) {
        setErro((await r.json().catch(() => ({}))).error ?? "não deu para mover");
        return;
      }
      setComentario("");
      await carregar();
      const atualizado = (await r.json()).contrato as Contrato;
      abrirCard(atualizado);
    } finally {
      setSalvando(false);
    }
  }

  async function comentar(c: Contrato) {
    if (!comentario.trim()) return;
    setSalvando(true);
    try {
      await fetch(`/api/contratos/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comentario }),
      });
      setComentario("");
      abrirCard(c);
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Espelho da regra do servidor (`motivoBloqueioMover`), só pra tela não
   * oferecer botão que a API vai recusar. Quem decide continua sendo o
   * servidor — aqui não dá para reaproveitar a função porque ela pede a
   * sessão inteira, e o componente é client.
   */
  const podeMover = (c: Contrato, para: number) => {
    if (permissoes?.editar) return true;
    return c.fase === FASE_CONFERENCIA && (para === FASE_CONFERENCIA + 1 || para === FASE_PENDENCIA);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-800">Contratos</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {contratos.length} em andamento
            {permissoes?.unidades && ` · ${permissoes.unidades.join(", ")}`}
          </p>
        </div>
        {permissoes?.editar && (
          <button
            onClick={() => {
              setAberto(null);
              setEditando({ ...CONTRATO_VAZIO, vendedor: [], comprador: [], banco: { contas: [] } });
            }}
            className="flex items-center gap-2 bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            <Plus size={16} /> Novo contrato
          </button>
        )}
      </div>

      {carregando && <p className="text-sm text-gray-500">Carregando…</p>}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {FASES.map((f, i) => {
          const lista = porFase.get(f.id) ?? [];
          return (
            <div key={f.id} className="w-64 shrink-0">
              <div className={`rounded-t-lg px-3 py-2 text-xs font-semibold ${CORES_FASE[i]}`}>
                {f.curto}
                <span className="float-right opacity-70">{lista.length}</span>
              </div>
              <div className="bg-gray-50 rounded-b-lg p-2 space-y-2 min-h-[120px]">
                {lista.map((c) => (
                  <CartaoContrato key={c.id} c={c} onAbrir={abrirCard} />
                ))}
                {lista.length === 0 && (
                  <p className="text-[11px] text-gray-400 text-center py-4">vazio</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Painel do card / formulário */}
      {(aberto || editando) && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => { setAberto(null); setEditando(null); }}>
          <div
            className="w-full max-w-2xl h-full bg-white overflow-y-auto p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">
                  {editando ? (editando.id ? `Editar ${editando.ref}` : "Novo contrato") : `Contrato ${aberto!.ref}`}
                </h2>
                {aberto && !editando && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {nomeFase(aberto.fase)} · {aberto.unidade} · {aberto.tipo === "venda" ? "Venda" : "Locação"}
                  </p>
                )}
              </div>
              <button onClick={() => { setAberto(null); setEditando(null); }} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}

            {editando ? (
              <ContratoForm
                valor={editando}
                unidades={todasUnidades}
                verBanco={permissoes?.verBanco ?? false}
                salvando={salvando}
                onChange={setEditando}
                onSalvar={salvarCard}
                onCancelar={() => setEditando(null)}
              />
            ) : aberto ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {podeMover(aberto, aberto.fase + 1) && aberto.fase < 7 && (
                    <button
                      onClick={() => mover(aberto, aberto.fase + 1, comentario)}
                      disabled={salvando}
                      className="flex items-center gap-1.5 bg-blue-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {salvando ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                      {aberto.fase === FASE_CONFERENCIA ? "Conferido" : "Avançar"}
                    </button>
                  )}
                  {aberto.fase === FASE_CONFERENCIA && podeMover(aberto, FASE_PENDENCIA) && (
                    <button
                      onClick={() => mover(aberto, FASE_PENDENCIA, comentario)}
                      disabled={salvando}
                      className="flex items-center gap-1.5 border border-amber-300 text-amber-800 text-sm px-3 py-1.5 rounded-lg hover:bg-amber-50 disabled:opacity-50"
                    >
                      <Undo2 size={14} /> Devolver para pendência
                    </button>
                  )}
                  {permissoes?.editar && (
                    <>
                      <select
                        value={aberto.fase}
                        onChange={(e) => mover(aberto, Number(e.target.value), comentario)}
                        className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                      >
                        {FASES.map((f) => (
                          <option key={f.id} value={f.id}>{f.nome}</option>
                        ))}
                      </select>
                      <button
                        onClick={() =>
                          setEditando({
                            id: aberto.id, ref: aberto.ref, imovel_id: aberto.imovel_id,
                            tipo: aberto.tipo, unidade: aberto.unidade,
                            corretor_id: aberto.corretor_id, corretor_nome: aberto.corretor_nome,
                            vendedor: aberto.vendedor ?? [], comprador: aberto.comprador ?? [],
                            imovel_endereco: aberto.imovel_endereco, imovel_dados: aberto.imovel_dados ?? {},
                            banco: aberto.banco ?? { contas: [] },
                            pagamento: aberto.pagamento, observacao: aberto.observacao,
                          })
                        }
                        className="border border-gray-300 text-sm px-3 py-1.5 rounded-lg hover:bg-gray-50"
                      >
                        Editar dados
                      </button>
                      <button
                        onClick={async () => {
                          await fetch(`/api/contratos/${aberto.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ arquivado: true }),
                          });
                          setAberto(null);
                          carregar();
                        }}
                        className="flex items-center gap-1.5 text-sm text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50"
                      >
                        <Archive size={14} /> Arquivar
                      </button>
                    </>
                  )}
                </div>

                <BlocoLeitura titulo="Imóvel">
                  <p className="text-sm text-gray-700">{aberto.imovel_endereco || "—"}</p>
                  <p className="text-xs text-gray-500 mt-1">Corretor: {aberto.corretor_nome || "—"}</p>
                </BlocoLeitura>

                <BlocoPessoasLeitura titulo="Vendedor" pessoas={aberto.vendedor ?? []} />
                <BlocoPessoasLeitura titulo="Comprador" pessoas={aberto.comprador ?? []} />

                {aberto.banco_oculto ? (
                  <BlocoLeitura titulo="Conta bancária">
                    <p className="text-xs text-gray-400">Visível apenas para o setor de contratos e a diretoria.</p>
                  </BlocoLeitura>
                ) : (
                  (aberto.banco?.contas ?? []).length > 0 && (
                    <BlocoLeitura titulo="Conta bancária do vendedor">
                      {(aberto.banco?.contas ?? []).map((c, i) => (
                        <p key={i} className="text-sm text-gray-700">
                          {c.titular} — {c.banco} · ag. {c.agencia} · cc {c.conta}
                          {c.pix ? ` · Pix ${c.pix}` : ""}
                        </p>
                      ))}
                    </BlocoLeitura>
                  )
                )}

                {aberto.pagamento && (
                  <BlocoLeitura titulo="Formas de pagamento">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{aberto.pagamento}</p>
                  </BlocoLeitura>
                )}

                {aberto.observacao && (
                  <BlocoLeitura titulo="Observação">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{aberto.observacao}</p>
                  </BlocoLeitura>
                )}

                <section>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Histórico</h3>
                  <div className="space-y-2">
                    {eventos.map((e) => (
                      <div key={e.id} className="text-xs text-gray-600 border-l-2 border-gray-200 pl-3 py-0.5">
                        <span className="text-gray-400">{diaHora(e.criado_em)}</span>{" "}
                        <strong className="text-gray-700">{e.criado_por_nome}</strong>{" "}
                        {e.para != null && (e.de != null
                          ? `moveu de "${nomeFase(e.de)}" para "${nomeFase(e.para)}"`
                          : `criou em "${nomeFase(e.para)}"`)}
                        {e.comentario && <span className="block text-gray-700 mt-0.5">{e.comentario}</span>}
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <input
                      value={comentario}
                      onChange={(e) => setComentario(e.target.value)}
                      placeholder="Escrever um comentário (vai junto se você mover o card)"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                    <button
                      onClick={() => comentar(aberto)}
                      disabled={salvando || !comentario.trim()}
                      className="flex items-center gap-1.5 border border-gray-300 text-sm px-3 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                    >
                      <MessageSquare size={14} /> Comentar
                    </button>
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function BlocoLeitura({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="border border-gray-200 rounded-xl p-4">
      <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">{titulo}</h3>
      {children}
    </section>
  );
}

const CAMPOS_LEITURA: { chave: keyof Pessoa; rotulo: string }[] = [
  { chave: "cpf", rotulo: "CPF" }, { chave: "rg", rotulo: "RG" },
  { chave: "estado_civil", rotulo: "Estado civil" }, { chave: "profissao", rotulo: "Profissão" },
  { chave: "nacionalidade", rotulo: "Nacionalidade" }, { chave: "celular", rotulo: "Celular" },
  { chave: "email", rotulo: "E-mail" }, { chave: "endereco", rotulo: "Endereço" },
  { chave: "cidade", rotulo: "Cidade" },
];

function BlocoPessoasLeitura({ titulo, pessoas }: { titulo: string; pessoas: Pessoa[] }) {
  if (!pessoas.length) return null;
  return (
    <BlocoLeitura titulo={titulo}>
      <div className="space-y-3">
        {pessoas.map((p, i) => (
          <div key={i}>
            <p className="text-sm font-medium text-gray-800">
              {p.nome}
              {p.percentual != null && <span className="text-xs text-gray-400 ml-2">{p.percentual}%</span>}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
              {CAMPOS_LEITURA.filter((c) => p[c.chave]).map((c) => (
                <span key={String(c.chave)} className="text-xs text-gray-600">
                  <span className="text-gray-400">{c.rotulo}:</span> {String(p[c.chave])}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </BlocoLeitura>
  );
}
