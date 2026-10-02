export interface Room {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  _count?: {
    messages: number
  }
}

export interface Reaction {
  emoji: string
  username: string
}

export interface Message {
  id: string
  content: string
  username: string
  roomId: string
  createdAt: string
  editedAt?: string | null
  reactions?: Reaction[]
}

export interface MessageEdited {
  id: string
  content: string
  editedAt: string
}

export interface MessageDeleted {
  id: string
}

export interface ReactionUpdate {
  messageId: string
  emoji: string
  username: string
  active: boolean
}

export interface PresenceUpdate {
  roomId: string
  users: string[]
}

export interface ChatError {
  event: string
  message: string
}
