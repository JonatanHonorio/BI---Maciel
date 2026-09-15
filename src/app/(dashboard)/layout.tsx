import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import VerComoBanner from "@/components/VerComoBanner";
import { getSessionFromCookies } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionFromCookies();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <Sidebar session={session} />
      <div className="flex-1">
        {session.verComo && <VerComoBanner verComo={session.verComo} />}
        <main className="ml-56 p-6">{children}</main>
      </div>
    </div>
  );
}
