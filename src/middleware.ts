import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const token = req.cookies.get("bi_token")?.value;

  // Se não tem token, redireciona para login
  if (!token) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Protege todas as rotas EXCETO:
     * - /login (página de login)
     * - /api/auth (endpoint de autenticação)
     * - /_next (assets do Next.js)
     * - /favicon.ico, /icon, etc.
     */
    "/((?!login|api/auth|_next|favicon\\.ico|icon).*)",
  ],
};
