"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [modoEsqueci, setModoEsqueci] = useState(false);
  const [emailEsqueci, setEmailEsqueci] = useState("");
  const [mensagemEsqueci, setMensagemEsqueci] = useState("");
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha }),
    });

    if (res.ok) {
      // A gerente administrativa não enxerga o /resumo — o destino vem da API.
      const { destino } = await res.json().catch(() => ({ destino: "/resumo" }));
      router.push(destino || "/resumo");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Não foi possível entrar");
    }
    setLoading(false);
  }

  async function handleEsqueci(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMensagemEsqueci("");

    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailEsqueci }),
    });
    const data = await res.json().catch(() => ({}));
    setMensagemEsqueci(
      res.ok ? "Se o e-mail existir, o link para definir a senha foi enviado." : data.error || "Erro ao enviar"
    );
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mb-3">
            <Building2 size={28} className="text-blue-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">BI Maciel</h1>
          <p className="text-sm text-gray-500">Maciel Negócios Imobiliários</p>
        </div>

        {!modoEsqueci ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu.nome@imobiliariamaciel.com.br"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="Digite a senha"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>}

            <button
              type="submit"
              disabled={loading || !email || !senha}
              className="w-full py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>

            <button
              type="button"
              onClick={() => {
                setModoEsqueci(true);
                setEmailEsqueci(email);
                setMensagemEsqueci("");
              }}
              className="w-full text-sm text-blue-600 hover:underline"
            >
              Esqueci minha senha
            </button>
          </form>
        ) : (
          <form onSubmit={handleEsqueci} className="space-y-4">
            <p className="text-sm text-gray-600">
              Informe seu e-mail. Se ele tiver acesso ao BI, enviamos um link para você definir a senha.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <input
                type="email"
                value={emailEsqueci}
                onChange={(e) => setEmailEsqueci(e.target.value)}
                placeholder="seu.nome@imobiliariamaciel.com.br"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                autoFocus
              />
            </div>

            {mensagemEsqueci && (
              <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded">{mensagemEsqueci}</p>
            )}

            <button
              type="submit"
              disabled={loading || !emailEsqueci}
              className="w-full py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "Enviando..." : "Enviar link"}
            </button>

            <button
              type="button"
              onClick={() => setModoEsqueci(false)}
              className="w-full text-sm text-gray-500 hover:underline"
            >
              Voltar
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
