"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Loader2, Search } from "lucide-react";

/**
 * Formulário do card de contrato.
 *
 * Os subcomponentes ficam em escopo de MÓDULO, nunca dentro do componente
 * principal: declarados lá dentro, o React os trata como um tipo novo a cada
 * render e remonta a árvore inteira — foi assim que o campo de corretor do
 * fechamento perdia o texto digitado a cada tecla (18/09/2026).
 */

export interface Pessoa {
  nome: string; cpf?: string; rg?: string; rg_emissor?: string;
  data_nascimento?: string | null; nacionalidade?: string; profissao?: string;
  estado_civil?: string; email?: string; celular?: string;
  endereco?: string; bairro?: string; cidade?: string; estado?: string; cep?: string;
  percentual?: number | null;
}

export interface ContaBancaria {
  titular: string; banco: string; agencia: string; conta: string; pix?: string;
}

export interface ContratoEdicao {
  id?: number;
  ref: string;
  imovel_id: number | null;
  tipo: "venda" | "locacao";
  unidade: string;
  corretor_id: number | null;
  corretor_nome: string;
  vendedor: Pessoa[];
  comprador: Pessoa[];
  imovel_endereco: string | null;
  imovel_dados: Record<string, unknown>;
  banco: { contas?: ContaBancaria[] } | null;
  pagamento: string | null;
  observacao: string | null;
}

type Corretor = { id: number; nome: string; unidade: string; tipo: "venda" | "locacao" | null };

export const CONTRATO_VAZIO: ContratoEdicao = {
  ref: "", imovel_id: null, tipo: "venda", unidade: "", corretor_id: null, corretor_nome: "",
  vendedor: [], comprador: [], imovel_endereco: "", imovel_dados: {}, banco: { contas: [] },
  pagamento: "", observacao: "",
};

const CAMPOS_PESSOA: { chave: keyof Pessoa; rotulo: string; largura?: string }[] = [
  { chave: "nome", rotulo: "Nome", largura: "sm:col-span-2" },
  { chave: "cpf", rotulo: "CPF" },
  { chave: "rg", rotulo: "RG" },
  { chave: "nacionalidade", rotulo: "Nacionalidade" },
  { chave: "estado_civil", rotulo: "Estado civil" },
  { chave: "profissao", rotulo: "Profissão" },
  { chave: "celular", rotulo: "Celular" },
  { chave: "email", rotulo: "E-mail" },
  { chave: "endereco", rotulo: "Endereço", largura: "sm:col-span-2" },
  { chave: "cidade", rotulo: "Cidade" },
  { chave: "cep", rotulo: "CEP" },
];

const rotulo = "block text-[11px] uppercase tracking-wide text-gray-500 mb-1";
const campo =
  "w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500";

function BlocoPessoas({
  titulo, pessoas, onChange, vazioTexto,
}: {
  titulo: string;
  pessoas: Pessoa[];
  onChange: (p: Pessoa[]) => void;
  vazioTexto: string;
}) {
  const alterar = (i: number, chave: keyof Pessoa, valor: string) => {
    const copia = pessoas.map((p, idx) => (idx === i ? { ...p, [chave]: valor } : p));
    onChange(copia);
  };

  return (
    <section className="border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700">{titulo}</h4>
        <button
          type="button"
          onClick={() => onChange([...pessoas, { nome: "" }])}
          className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
        >
          <Plus size={13} /> Adicionar
        </button>
      </div>

      {pessoas.length === 0 && <p className="text-xs text-gray-400">{vazioTexto}</p>}

      <div className="space-y-4">
        {pessoas.map((p, i) => (
          <div key={i} className="relative grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {pessoas.length > 1 && (
              <span className="absolute -top-2 left-0 text-[10px] font-semibold text-gray-400">
                {i + 1}º {p.percentual != null ? `· ${p.percentual}%` : ""}
              </span>
            )}
            {CAMPOS_PESSOA.map((c) => (
              <div key={String(c.chave)} className={c.largura}>
                <label className={rotulo}>{c.rotulo}</label>
                <input
                  className={campo}
                  value={(p[c.chave] as string) ?? ""}
                  onChange={(e) => alterar(i, c.chave, e.target.value)}
                />
              </div>
            ))}
            <div className="sm:col-span-2 flex justify-end">
              <button
                type="button"
                onClick={() => onChange(pessoas.filter((_, idx) => idx !== i))}
                className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1"
              >
                <Trash2 size={13} /> Remover
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BlocoBancario({
  contas, onChange,
}: {
  contas: ContaBancaria[];
  onChange: (c: ContaBancaria[]) => void;
}) {
  const alterar = (i: number, chave: keyof ContaBancaria, valor: string) =>
    onChange(contas.map((c, idx) => (idx === i ? { ...c, [chave]: valor } : c)));

  return (
    <section className="border border-amber-200 bg-amber-50/40 rounded-xl p-4">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-sm font-semibold text-amber-900">Conta bancária do vendedor</h4>
        <button
          type="button"
          onClick={() => onChange([...contas, { titular: "", banco: "", agencia: "", conta: "" }])}
          className="text-xs text-amber-800 hover:text-amber-900 flex items-center gap-1"
        >
          <Plus size={13} /> Adicionar
        </button>
      </div>
      <p className="text-[11px] text-amber-800 mb-3">
        Visível só para o setor de contratos e a diretoria — gerente não enxerga este bloco.
      </p>

      {contas.length === 0 && (
        <p className="text-xs text-amber-700">
          O Kurole não guarda conta bancária, então este bloco é sempre preenchido à mão.
        </p>
      )}

      <div className="space-y-3">
        {contas.map((c, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2">
              <label className={rotulo}>Titular</label>
              <input className={campo} value={c.titular} onChange={(e) => alterar(i, "titular", e.target.value)} />
            </div>
            <div>
              <label className={rotulo}>Banco</label>
              <input className={campo} value={c.banco} onChange={(e) => alterar(i, "banco", e.target.value)} />
            </div>
            <div>
              <label className={rotulo}>Agência</label>
              <input className={campo} value={c.agencia} onChange={(e) => alterar(i, "agencia", e.target.value)} />
            </div>
            <div>
              <label className={rotulo}>Conta</label>
              <input className={campo} value={c.conta} onChange={(e) => alterar(i, "conta", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className={rotulo}>Chave Pix</label>
              <input className={campo} value={c.pix ?? ""} onChange={(e) => alterar(i, "pix", e.target.value)} />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => onChange(contas.filter((_, idx) => idx !== i))}
                className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1 pb-2"
              >
                <Trash2 size={13} /> Remover
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ContratoForm({
  valor, unidades, verBanco, salvando, onChange, onSalvar, onCancelar,
}: {
  valor: ContratoEdicao;
  unidades: readonly string[];
  verBanco: boolean;
  salvando: boolean;
  onChange: (c: ContratoEdicao) => void;
  onSalvar: () => void;
  onCancelar: () => void;
}) {
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [avisoRef, setAvisoRef] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/contratos/corretores")
      .then((r) => (r.ok ? r.json() : { corretores: [] }))
      .then((d) => setCorretores(d.corretores ?? []))
      .catch(() => setCorretores([]));
  }, []);

  const mudar = <K extends keyof ContratoEdicao>(chave: K, v: ContratoEdicao[K]) =>
    onChange({ ...valor, [chave]: v });

  /**
   * Busca o imóvel pela referência. Preenche endereço, ficha e o VENDEDOR, mas
   * só sobrescreve o vendedor quando ele ainda está vazio — a Ana pode ter
   * corrigido um dado que o Kurole tem errado, e a busca dispara no blur, ou
   * seja, várias vezes durante o preenchimento.
   */
  const buscarImovel = useCallback(async () => {
    const ref = valor.ref.trim();
    if (!ref) return;
    setBuscando(true);
    setAvisoRef(null);
    try {
      const r = await fetch(`/api/contratos/imovel?ref=${encodeURIComponent(ref)}`);
      if (!r.ok) {
        setAvisoRef(r.status === 404 ? "Imóvel não encontrado com essa referência." : "Não deu para buscar o imóvel.");
        return;
      }
      const d = await r.json();
      onChange({
        ...valor,
        imovel_id: d.imovel_id ?? null,
        imovel_endereco: d.endereco || valor.imovel_endereco,
        imovel_dados: d.imovel_dados ?? valor.imovel_dados,
        vendedor: valor.vendedor.length ? valor.vendedor : (d.vendedor ?? []),
      });
      if (d.sem_proprietario) setAvisoRef("O imóvel não tem proprietário cadastrado no Kurole.");
    } finally {
      setBuscando(false);
    }
  }, [valor, onChange]);

  const escolherCorretor = (texto: string) => {
    const achado = corretores.find((c) => c.nome === texto);
    onChange({
      ...valor,
      corretor_nome: texto,
      corretor_id: achado?.id ?? null,
      // A unidade acompanha o corretor, mas só quando ainda não foi definida ou
      // quando o corretor tem lotação conhecida — negócio de Diretoria e
      // Lançamento fica com a unidade escolhida à mão.
      unidade: achado?.unidade || valor.unidade,
      tipo: achado?.tipo ?? valor.tipo,
    });
  };

  const contas = valor.banco?.contas ?? [];

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <label className={rotulo}>Referência</label>
          <div className="relative">
            <input
              className={campo}
              value={valor.ref}
              onChange={(e) => mudar("ref", e.target.value)}
              onBlur={buscarImovel}
              placeholder="58298"
            />
            <span className="absolute right-2 top-1.5 text-gray-400">
              {buscando ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            </span>
          </div>
        </div>
        <div>
          <label className={rotulo}>Tipo</label>
          <select className={campo} value={valor.tipo} onChange={(e) => mudar("tipo", e.target.value as "venda" | "locacao")}>
            <option value="venda">Venda</option>
            <option value="locacao">Locação</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={rotulo}>Corretor</label>
          <input
            className={campo}
            list="lista-corretores-contrato"
            value={valor.corretor_nome}
            onChange={(e) => escolherCorretor(e.target.value)}
            placeholder="digite parte do nome"
          />
          <datalist id="lista-corretores-contrato">
            {corretores.map((c) => (
              <option key={c.id} value={c.nome}>
                {c.unidade}
                {c.tipo ? ` · ${c.tipo === "venda" ? "Vendas" : "Locação"}` : ""}
              </option>
            ))}
          </datalist>
        </div>
        <div>
          <label className={rotulo}>Unidade</label>
          <select className={campo} value={valor.unidade} onChange={(e) => mudar("unidade", e.target.value)}>
            <option value="">selecione</option>
            {unidades.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-3">
          <label className={rotulo}>Endereço do imóvel</label>
          <input
            className={campo}
            value={valor.imovel_endereco ?? ""}
            onChange={(e) => mudar("imovel_endereco", e.target.value)}
          />
        </div>
      </section>

      {avisoRef && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{avisoRef}</p>
      )}

      {Object.keys(valor.imovel_dados ?? {}).length > 0 && (
        <section className="flex flex-wrap gap-2">
          {Object.entries(valor.imovel_dados)
            .filter(([, v]) => v !== null && v !== "" && v !== undefined)
            .map(([k, v]) => (
              <span key={k} className="text-[11px] bg-gray-100 text-gray-600 rounded-full px-2.5 py-1">
                {k.replace(/_/g, " ")}: <strong className="text-gray-800">{String(v)}</strong>
              </span>
            ))}
        </section>
      )}

      <BlocoPessoas
        titulo="Dados do vendedor (proprietário)"
        pessoas={valor.vendedor}
        onChange={(p) => mudar("vendedor", p)}
        vazioTexto="Digite a referência para puxar do Kurole, ou adicione na mão."
      />

      <BlocoPessoas
        titulo="Dados do comprador"
        pessoas={valor.comprador}
        onChange={(p) => mudar("comprador", p)}
        vazioTexto="Nenhum comprador ainda."
      />

      {verBanco && <BlocoBancario contas={contas} onChange={(c) => mudar("banco", { contas: c })} />}

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={rotulo}>Formas de pagamento</label>
          <textarea
            className={`${campo} h-24`}
            value={valor.pagamento ?? ""}
            onChange={(e) => mudar("pagamento", e.target.value)}
            placeholder="Ex.: Entrada R$ 50.000 + financiamento Caixa R$ 300.000"
          />
        </div>
        <div>
          <label className={rotulo}>Observação</label>
          <textarea
            className={`${campo} h-24`}
            value={valor.observacao ?? ""}
            onChange={(e) => mudar("observacao", e.target.value)}
          />
        </div>
      </section>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancelar} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
          Cancelar
        </button>
        <button
          type="button"
          onClick={onSalvar}
          disabled={salvando}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {salvando && <Loader2 size={14} className="animate-spin" />}
          Salvar
        </button>
      </div>
    </div>
  );
}
