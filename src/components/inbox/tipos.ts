/** Tipos compartilhados entre os componentes da central de atendimento. */

export type ItemConversa = {
  id: string;
  status: string;
  priority: string;
  unreadCount: number;
  isFavorite: boolean;
  lastMessageAt: string;
  createdAt: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  contact: {
    id: string;
    name: string;
    phone: string;
    phoneMasked: boolean;
    profilePictureUrl: string | null;
  };
  lastMessage: { content: string; direction: string; senderType: string } | null;
  tags: { id: string; name: string; color: string }[];
  stalledMinutes: number | null;
  isDemo: boolean;
};

export type Mensagem = {
  id: string;
  conversationId: string;
  senderType: string;
  senderUserId: string | null;
  senderName: string | null;
  messageType: string;
  content: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  replyToMessageId: string | null;
  direction: string;
  status: string;
  failureReason: string | null;
  aiSuggested: boolean;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
};

export type DetalheConversa = {
  conversation: {
    id: string;
    status: string;
    priority: string;
    unreadCount: number;
    isFavorite: boolean;
    assignedUserId: string | null;
    assignedTeamId: string | null;
    createdAt: string;
    assignedAt: string | null;
    firstResponseAt: string | null;
    closedAt: string | null;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    closingReason: string | null;
    outcome: string | null;
    isDemo: boolean;
  };
  contact: {
    id: string;
    name: string;
    phone: string;
    phoneMasked: boolean;
    email: string | null;
    companyName: string | null;
    city: string | null;
    source: string;
    notes: string | null;
    isBlocked: boolean;
    firstContactAt: string;
    lastContactAt: string;
  } | null;
  assignedUser: { id: string; name: string; avatarUrl: string | null } | null;
  connection: {
    id: string;
    label: string;
    displayPhoneNumber: string;
    provider: string;
    extension: string | null;
    isDemo: boolean;
  } | null;
  tags: { id: string; name: string; color: string }[];
  events: {
    id: string;
    eventType: string;
    actorName: string | null;
    previousValue: Record<string, unknown> | null;
    newValue: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }[];
  followups: {
    id: string;
    scheduledAt: string;
    note: string | null;
    status: string;
  }[];
  permissions: {
    canTransfer: boolean;
    canClose: boolean;
    canAssignOthers: boolean;
    canBlockContact: boolean;
    canSeeFullPhone: boolean;
  };
};

export type RespostaRapida = {
  id: string;
  title: string;
  shortcut: string;
  content: string;
  category: string | null;
};

export type Marcador = { id: string; name: string; color: string };

export type MembroEquipe = {
  id: string;
  name: string;
  role: string;
  availabilityStatus: "online" | "away" | "offline";
  isActive: boolean;
  activeConversations: number;
};

export type EquipeResumo = { id: string; name: string; color: string };

export const FILAS = [
  { chave: "all", rotulo: "Todos" },
  { chave: "unassigned", rotulo: "Não atribuídos" },
  { chave: "mine", rotulo: "Meus atendimentos" },
  { chave: "waiting", rotulo: "Aguardando" },
  { chave: "in_progress", rotulo: "Em atendimento" },
  { chave: "waiting_customer", rotulo: "Aguardando cliente" },
  { chave: "high_priority", rotulo: "Prioridade alta" },
  { chave: "unread", rotulo: "Não lidos" },
  { chave: "favorites", rotulo: "Favoritos" },
  { chave: "closed", rotulo: "Encerrados" },
] as const;

export type ChaveFila = (typeof FILAS)[number]["chave"];
