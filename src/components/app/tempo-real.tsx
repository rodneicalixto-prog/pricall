"use client";

/**
 * Assinatura do canal SSE.
 *
 * Reconecta sozinho com backoff e expõe o estado da conexão, para a UI poder
 * avisar quando o usuário estiver offline.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type EventoTempoReal = {
  type: string;
  conversationId?: string;
  messageId?: string;
  userId?: string | null;
  userName?: string;
  isTyping?: boolean;
  status?: string;
  notificationId?: string;
  connectionId?: string;
};

type Ouvinte = (evento: EventoTempoReal) => void;

type ValorTempoReal = {
  conectado: boolean;
  online: boolean;
  assinar: (ouvinte: Ouvinte) => () => void;
};

const Contexto = createContext<ValorTempoReal>({
  conectado: false,
  online: true,
  assinar: () => () => {},
});

export function useTempoReal() {
  return useContext(Contexto);
}

/** Registra um ouvinte para tipos específicos de evento. */
export function useEventoTempoReal(
  tipos: string[],
  aoReceber: (evento: EventoTempoReal) => void,
) {
  const { assinar } = useTempoReal();
  const referencia = useRef(aoReceber);
  referencia.current = aoReceber;

  useEffect(() => {
    return assinar((evento) => {
      if (tipos.includes(evento.type)) referencia.current(evento);
    });
    // `tipos` é estável na prática (array literal por chamada).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinar, tipos.join(",")]);
}

export function ProvedorTempoReal({ children }: { children: ReactNode }) {
  const [conectado, setConectado] = useState(false);
  const [online, setOnline] = useState(true);
  const ouvintes = useRef(new Set<Ouvinte>());
  const jaConectouAlgumaVez = useRef(false);

  const assinar = useCallback((ouvinte: Ouvinte) => {
    ouvintes.current.add(ouvinte);
    return () => {
      ouvintes.current.delete(ouvinte);
    };
  }, []);

  useEffect(() => {
    const atualizarRede = () => setOnline(navigator.onLine);
    atualizarRede();
    window.addEventListener("online", atualizarRede);
    window.addEventListener("offline", atualizarRede);
    return () => {
      window.removeEventListener("online", atualizarRede);
      window.removeEventListener("offline", atualizarRede);
    };
  }, []);

  useEffect(() => {
    let fonte: EventSource | null = null;
    let tentativa = 0;
    let temporizador: ReturnType<typeof setTimeout> | null = null;
    let encerrado = false;

    const conectar = () => {
      if (encerrado) return;
      fonte = new EventSource("/api/realtime");

      fonte.onopen = () => {
        const reconexao = tentativa > 0 || jaConectouAlgumaVez.current;
        tentativa = 0;
        jaConectouAlgumaVez.current = true;
        setConectado(true);

        /**
         * Em serverless a conexão é cortada periodicamente. Ao reconectar,
         * qualquer evento publicado durante a queda foi perdido — então
         * pedimos aos componentes que revalidem o que estão exibindo.
         */
        if (reconexao) {
          for (const ouvinte of ouvintes.current) {
            ouvinte({ type: "realtime.reconnected" });
          }
        }
      };

      fonte.onmessage = (evento) => {
        try {
          const dados = JSON.parse(evento.data) as EventoTempoReal;
          if (dados.type === "heartbeat" || dados.type === "connected") return;
          for (const ouvinte of ouvintes.current) ouvinte(dados);
        } catch {
          /* payload inesperado */
        }
      };

      fonte.onerror = () => {
        setConectado(false);
        fonte?.close();
        fonte = null;
        // Backoff progressivo até 30 s.
        const espera = Math.min(1000 * 2 ** tentativa, 30_000);
        tentativa += 1;
        temporizador = setTimeout(conectar, espera);
      };
    };

    conectar();
    return () => {
      encerrado = true;
      if (temporizador) clearTimeout(temporizador);
      fonte?.close();
      setConectado(false);
    };
  }, []);

  return (
    <Contexto.Provider value={{ conectado, online, assinar }}>
      {children}
    </Contexto.Provider>
  );
}
