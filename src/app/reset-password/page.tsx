"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2 } from "lucide-react";

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const email = params.get("email") || "";
  const token = params.get("token") || "";

  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (senha !== confirmacao) {
      setError("As senhas não conferem");
      return;
    }
    if (senha.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, token, novaSenha: senha }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (res.ok) {
      setSucesso(true);
      setTimeout(() => router.push("/login"), 2000);
    } else {
      setError(data.error || "Não foi possível definir a senha");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mb-3">
            <Building2 size={28} className="text-blue-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Definir senha</h1>
          <p className="text-sm text-gray-500">{email || "BI Maciel"}</p>
        </div>

        {!email || !token ? (
          <p className="text-sm text-red-600 bg-red-50 p-2 rounded">
            Link inválido. Peça um novo em &quot;Esqueci minha senha&quot; na tela de login.
          </p>
        ) : sucesso ? (
          <p className="text-sm text-green-700 bg-green-50 p-2 rounded">
            Senha definida! Levando você para o login...
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="Pelo menos 8 caracteres"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirme a senha</label>
              <input
                type="password"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>}

            <button
              type="submit"
              disabled={loading || !senha || !confirmacao}
              className="w-full py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "Salvando..." : "Salvar senha"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
