interface PresenceListProps {
  users: string[]
  username: string
}

const MAX_VISIBLE = 5

function PresenceList({ users, username }: PresenceListProps) {
  const visible = users.slice(0, MAX_VISIBLE)
  const hidden = users.length - visible.length

  return (
    <div className="flex items-center gap-2" title={users.join(', ')}>
      <div className="flex -space-x-2">
        {visible.map((user) => (
          <div
            key={user}
            className={`relative h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold text-white ring-2 ring-white ${
              user === username ? 'bg-indigo-600' : 'bg-gray-500'
            }`}
            aria-label={user === username ? `${user} (you)` : user}
          >
            {user.slice(0, 2).toUpperCase()}
            <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-green-500 ring-1 ring-white" />
          </div>
        ))}
        {hidden > 0 && (
          <div className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold bg-gray-200 text-gray-700 ring-2 ring-white">
            +{hidden}
          </div>
        )}
      </div>
      <span className="text-sm text-gray-500">{users.length} online</span>
    </div>
  )
}

export default PresenceList
