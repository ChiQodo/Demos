import { useState } from 'react'
import { Reaction } from '../types'

// Must match REACTION_EMOJIS in backend/src/chat/chat.validation.ts.
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢']

interface ReactionBarProps {
  reactions: Reaction[]
  username: string
  isOwnMessage: boolean
  onSetReaction: (emoji: string, active: boolean) => void
}

function ReactionBar({ reactions, username, isOwnMessage, onSetReaction }: ReactionBarProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false)

  const grouped = REACTION_EMOJIS.map((emoji) => {
    const users = reactions.filter((r) => r.emoji === emoji).map((r) => r.username)
    return { emoji, users, mine: users.includes(username) }
  }).filter((group) => group.users.length > 0)

  const hasReacted = (emoji: string) =>
    reactions.some((r) => r.emoji === emoji && r.username === username)

  const handlePick = (emoji: string) => {
    onSetReaction(emoji, !hasReacted(emoji))
    setIsPickerOpen(false)
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-1 mt-1 ${
        isOwnMessage ? 'justify-end' : 'justify-start'
      }`}
    >
      {grouped.map(({ emoji, users, mine }) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onSetReaction(emoji, !mine)}
          title={users.join(', ')}
          aria-pressed={mine}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors duration-150 ${
            mine
              ? 'bg-indigo-100 border-indigo-400 text-indigo-800'
              : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
          }`}
        >
          <span>{emoji}</span>
          <span>{users.length}</span>
        </button>
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => setIsPickerOpen((open) => !open)}
          aria-label="Add reaction"
          aria-expanded={isPickerOpen}
          className="px-2 py-0.5 rounded-full text-xs border border-dashed border-gray-300 text-gray-500 hover:bg-gray-100"
        >
          +
        </button>
        {isPickerOpen && (
          <div
            className={`absolute z-10 bottom-full mb-1 flex gap-1 bg-white border border-gray-200 rounded-lg shadow-lg p-1 ${
              isOwnMessage ? 'right-0' : 'left-0'
            }`}
          >
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handlePick(emoji)}
                aria-label={`React with ${emoji}`}
                className="text-lg px-1 rounded hover:bg-gray-100"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ReactionBar
