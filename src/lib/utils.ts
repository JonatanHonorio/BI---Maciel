import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Junta classes do Tailwind resolvendo conflitos — é o utilitário que todo
 * componente do shadcn/ui e do 21st.dev espera encontrar em "@/lib/utils".
 *
 * `twMerge` existe porque `clsx` sozinho concatena: passar "p-2" e depois "p-4"
 * deixaria as duas na string e o resultado dependeria da ordem no CSS. Com o
 * merge, a última vence, que é o que quem escreve o componente espera.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
