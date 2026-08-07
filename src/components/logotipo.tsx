import { cn } from "@/lib/utils";

/**
 * Logotipo do PRICALL — identidade própria, sem nenhuma referência visual
 * ao WhatsApp. Três balões escalonados representam a fila compartilhada.
 */
export function Logotipo({
  tamanho = "medio",
  className,
  somenteSimbolo = false,
}: {
  tamanho?: "pequeno" | "medio" | "grande";
  className?: string;
  somenteSimbolo?: boolean;
}) {
  const dimensoes = { pequeno: 24, medio: 32, grande: 44 }[tamanho];
  const textos = {
    pequeno: "text-base",
    medio: "text-lg",
    grande: "text-2xl",
  }[tamanho];

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg
        width={dimensoes}
        height={dimensoes}
        viewBox="0 0 40 40"
        fill="none"
        role="img"
        aria-label="PRICALL"
      >
        <rect width="40" height="40" rx="10" fill="var(--primaria, #16A34A)" />
        <path
          d="M11 13.5a2.5 2.5 0 0 1 2.5-2.5h9a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5h-5.4L13 24.5V21h-1.5A2.5 2.5 0 0 1 9 18.5v-5"
          fill="#FFFFFF"
          fillOpacity="0.95"
          transform="translate(1 0)"
        />
        <circle cx="27.5" cy="24.5" r="4.5" fill="#FFFFFF" fillOpacity="0.55" />
        <circle cx="20" cy="28" r="3" fill="#FFFFFF" fillOpacity="0.35" />
      </svg>
      {!somenteSimbolo && (
        <span className={cn("font-bold tracking-tight", textos)}>PRICALL</span>
      )}
    </span>
  );
}
