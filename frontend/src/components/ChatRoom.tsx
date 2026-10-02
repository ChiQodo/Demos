import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import {
  Room,
  Message,
  ReactionUpdate,
  PresenceUpdate,
  ChatError,
  MessageEdited,
  MessageDeleted,
} from '../types'
import ReactionBar from './ReactionBar'
import PresenceList from './PresenceList'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000'
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

function applyReactionUpdate(messages: Message[], update: ReactionUpdate): Message[] {
  return messages.map((message) => {
    if (message.id !== update.messageId) return message
    const others = (message.reactions ?? []).filter(
      (r) => !(r.emoji === update.emoji && r.username === update.username),
    )
    const reactions = update.active
      ? [...others, { emoji: update.emoji, username: update.username }]
      : others
    return { ...message, reactions }
  })
}

type MessagesUpdate = (messages: Message[]) => Message[]

// Must match MAX_MESSAGE_LENGTH in backend/src/chat/chat.validation.ts.
const MAX_MESSAGE_LENGTH = 2000

interface ChatRoomProps {
  room: Room
  username: string
}

function ChatRoom({ room, username }: ChatRoomProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isTyping, setIsTyping] = useState<{ [key: string]: boolean }>({})
  const [onlineUsers, setOnlineUsers] = useState<string[]>([])
  const [chatError, setChatError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // scrollHeight before prepending older messages, to keep the view anchored.
  const prependAnchorRef = useRef<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  // Lets an in-flight older-page request detect that the user switched rooms.
  const currentRoomIdRef = useRef(room.id)
  currentRoomIdRef.current = room.id
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Live updates can arrive before roomHistory; replay them onto it.
  const pendingUpdatesRef = useRef<MessagesUpdate[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages[messages.length - 1]?.id])

  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (container && prependAnchorRef.current !== null) {
      container.scrollTop += container.scrollHeight - prependAnchorRef.current
      prependAnchorRef.current = null
    }
  }, [messages])

  useEffect(() => {
    // Connect to socket
    const newSocket = io(SOCKET_URL)
    setSocket(newSocket)

    // Join on every connect so the room is rejoined after a reconnect
    newSocket.on('connect', () => {
      pendingUpdatesRef.current = []
      newSocket.emit('joinRoom', { roomId: room.id, username })
    })

    // Listen for room history
    newSocket.on('roomHistory', (data: { messages: Message[]; hasMoreMessages?: boolean }) => {
      setHasMore(Boolean(data.hasMoreMessages))
      if (data.messages) {
        const pending = pendingUpdatesRef.current ?? []
        setMessages(pending.reduce((msgs, update) => update(msgs), data.messages))
      }
      pendingUpdatesRef.current = null
    })

    // Listen for new messages
    newSocket.on('newMessage', (message: Message) => {
      setMessages((prev) => [...prev, message])
    })

    // Listen for user joined
    newSocket.on('userJoined', (data: { username: string }) => {
      console.log(`${data.username} joined the room`)
    })

    // Listen for user left
    newSocket.on('userLeft', (data: { username: string }) => {
      console.log(`${data.username} left the room`)
    })

    // Listen for typing indicators
    newSocket.on('userTyping', (data: { username: string; isTyping: boolean }) => {
      setIsTyping((prev) => ({
        ...prev,
        [data.username]: data.isTyping,
      }))
    })

    const applyLive = (update: MessagesUpdate) => {
      if (pendingUpdatesRef.current) {
        pendingUpdatesRef.current.push(update)
        return
      }
      setMessages(update)
    }

    newSocket.on('reactionUpdate', (update: ReactionUpdate) => {
      applyLive((msgs) => applyReactionUpdate(msgs, update))
    })

    newSocket.on('messageEdited', (edited: MessageEdited) => {
      applyLive((msgs) =>
        msgs.map((m) =>
          m.id === edited.id ? { ...m, content: edited.content, editedAt: edited.editedAt } : m,
        ),
      )
    })

    newSocket.on('messageDeleted', ({ id }: MessageDeleted) => {
      applyLive((msgs) => msgs.filter((m) => m.id !== id))
      setEditingId((current) => (current === id ? null : current))
    })

    newSocket.on('presenceUpdate', (data: PresenceUpdate) => {
      if (data.roomId === room.id) {
        setOnlineUsers(data.users)
      }
    })

    newSocket.on('chatError', (error: ChatError) => {
      setChatError(error.message)
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current)
      }
      errorTimeoutRef.current = setTimeout(() => setChatError(null), 4000)
    })

    // Cleanup
    return () => {
      newSocket.emit('leaveRoom', { roomId: room.id, username })
      newSocket.close()
      setOnlineUsers([])
      setMessages([])
      setEditingId(null)
      setHasMore(false)
      setIsLoadingOlder(false)
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current)
      }
    }
  }, [room.id, username])

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (newMessage.trim() && socket) {
      socket.emit('sendMessage', {
        roomId: room.id,
        username,
        content: newMessage,
      })
      setNewMessage('')
      
      // Stop typing indicator
      socket.emit('typing', {
        roomId: room.id,
        username,
        isTyping: false,
      })
    }
  }

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value)

    if (!socket) return

    // Send typing indicator
    socket.emit('typing', {
      roomId: room.id,
      username,
      isTyping: true,
    })

    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    // Set new timeout to stop typing indicator
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing', {
        roomId: room.id,
        username,
        isTyping: false,
      })
    }, 1000)
  }

  const loadOlder = async () => {
    if (isLoadingOlder) return
    const roomId = room.id
    const oldest = messages[0]
    setIsLoadingOlder(true)
    try {
      // With no messages loaded (e.g. all deleted), fetch the newest page.
      const params = new URLSearchParams(oldest ? { before: oldest.id } : {})
      const response = await fetch(`${API_URL}/rooms/${roomId}/messages?${params}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const page: { messages: Message[]; hasMore: boolean } = await response.json()
      if (currentRoomIdRef.current !== roomId) return
      prependAnchorRef.current = scrollContainerRef.current?.scrollHeight ?? null
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id))
        return [...page.messages.filter((m) => !known.has(m.id)), ...prev]
      })
      setHasMore(page.hasMore)
    } catch (error) {
      console.error('Error loading older messages:', error)
      setChatError('Could not load older messages')
    } finally {
      if (currentRoomIdRef.current === roomId) setIsLoadingOlder(false)
    }
  }

  const startEditing = (message: Message) => {
    setEditingId(message.id)
    setEditDraft(message.content)
  }

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault()
    const content = editDraft.trim()
    if (!socket || !editingId || !content) return
    socket.emit('editMessage', { roomId: room.id, messageId: editingId, content })
    setEditingId(null)
  }

  const handleDelete = (messageId: string) => {
    if (socket && window.confirm('Delete this message?')) {
      socket.emit('deleteMessage', { roomId: room.id, messageId })
    }
  }

  const handleSetReaction = (messageId: string, emoji: string, active: boolean) => {
    socket?.emit('setReaction', { roomId: room.id, messageId, username, emoji, active })
  }

  const typingUsers = Object.entries(isTyping)
    .filter(([user, typing]) => typing && user !== username)
    .map(([user]) => user)

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800">{room.name}</h2>
          <p className="text-sm text-gray-500">
            {messages.length} message{messages.length !== 1 ? 's' : ''}
          </p>
        </div>
        <PresenceList users={onlineUsers} username={username} />
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {hasMore && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={loadOlder}
              disabled={isLoadingOlder}
              className="text-sm text-indigo-600 hover:underline disabled:text-gray-400"
            >
              {isLoadingOlder ? 'Loading…' : 'Load older messages'}
            </button>
          </div>
        )}
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <p className="mt-2 text-sm">No messages yet</p>
              <p className="text-xs text-gray-400">Be the first to send a message!</p>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.username === username ? 'justify-end' : 'justify-start'}`}
            >
              <div className="flex flex-col max-w-xs lg:max-w-md">
                <div
                  className={`px-4 py-2 rounded-lg ${
                    message.username === username
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-gray-800'
                  }`}
                >
                  {message.username !== username && (
                    <p className="text-xs font-semibold mb-1">{message.username}</p>
                  )}
                  {editingId === message.id ? (
                    <form onSubmit={handleSaveEdit} className="flex flex-col gap-1">
                      <input
                        type="text"
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Escape' && setEditingId(null)}
                        maxLength={MAX_MESSAGE_LENGTH}
                        autoFocus
                        aria-label="Edit message"
                        className="px-2 py-1 rounded text-gray-800"
                      />
                      <div className="flex gap-2 text-xs">
                        <button type="submit" disabled={!editDraft.trim()} className="underline">
                          Save
                        </button>
                        <button type="button" onClick={() => setEditingId(null)} className="underline">
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className="break-words">{message.content}</p>
                  )}
                  <p
                    className={`text-xs mt-1 ${
                      message.username === username ? 'text-indigo-200' : 'text-gray-500'
                    }`}
                  >
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {message.editedAt && ' (edited)'}
                  </p>
                </div>
                {message.username === username && editingId !== message.id && (
                  <div className="flex justify-end gap-2 mt-1 text-xs text-gray-500">
                    <button type="button" onClick={() => startEditing(message)} className="hover:underline">
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(message.id)}
                      className="hover:underline hover:text-red-600"
                    >
                      Delete
                    </button>
                  </div>
                )}
                <ReactionBar
                  reactions={message.reactions ?? []}
                  username={username}
                  isOwnMessage={message.username === username}
                  onSetReaction={(emoji, active) => handleSetReaction(message.id, emoji, active)}
                />
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing indicator */}
      {typingUsers.length > 0 && (
        <div className="px-4 py-2 text-sm text-gray-500">
          {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
        </div>
      )}

      {chatError && (
        <div role="alert" className="px-4 py-2 text-sm text-red-600 bg-red-50 border-t border-red-100">
          {chatError}
        </div>
      )}

      {/* Input */}
      <div className="bg-white border-t border-gray-200 p-4">
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={handleTyping}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={!newMessage.trim()}
            className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors duration-200 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  )
}

export default ChatRoom
