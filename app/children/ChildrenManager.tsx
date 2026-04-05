'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const COLORS = ['#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316']

interface Child { id: string; name: string; color: string }

export default function ChildrenManager({ initialChildren }: { initialChildren: Child[] }) {
  const router = useRouter()
  const [children, setChildren] = useState(initialChildren)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    if (editId) {
      const res = await fetch(`/api/children/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color }),
      })
      const updated = await res.json()
      setChildren(prev => prev.map(c => c.id === editId ? updated : c))
    } else {
      const res = await fetch('/api/children', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color }),
      })
      const created = await res.json()
      setChildren(prev => [...prev, created])
    }
    setSaving(false)
    resetForm()
  }

  function startEdit(child: Child) {
    setEditId(child.id)
    setName(child.name)
    setColor(child.color)
    setShowForm(true)
  }

  function resetForm() {
    setShowForm(false)
    setEditId(null)
    setName('')
    setColor(COLORS[0])
  }

  async function deleteChild(id: string) {
    if (!confirm('Delete this child profile? All progress and bookmarks will be lost.')) return
    await fetch(`/api/children/${id}`, { method: 'DELETE' })
    setChildren(prev => prev.filter(c => c.id !== id))
    router.refresh()
  }

  return (
    <div>
      {/* Child list */}
      <div className="space-y-3 mb-5">
        {children.length === 0 && (
          <p className="text-gray-400 text-center py-8">No kids yet — add one below!</p>
        )}
        {children.map(child => (
          <div key={child.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-xl font-bold flex-shrink-0"
              style={{ backgroundColor: child.color }}>
              {child.name[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-800">{child.name}</p>
            </div>
            <Link href={`/children/${child.id}`}
              className="text-xs bg-amber-100 text-amber-700 px-3 py-1.5 rounded-lg font-medium hover:bg-amber-200 transition-colors">
              Dashboard
            </Link>
            <button onClick={() => startEdit(child)}
              className="text-gray-400 hover:text-gray-600 px-2 text-lg">✏️</button>
            <button onClick={() => deleteChild(child.id)}
              className="text-gray-400 hover:text-red-500 px-2 text-lg">🗑</button>
          </div>
        ))}
      </div>

      {/* Add / Edit form */}
      {showForm ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-700 mb-4">{editId ? 'Edit profile' : 'New kid'}</h2>
          <input
            type="text"
            placeholder="Child's name"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
            autoFocus
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 mb-4 text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div className="flex gap-2 flex-wrap mb-4">
            {COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)}
                className={`w-9 h-9 rounded-full transition-all ${color === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={resetForm} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl font-medium">
              Cancel
            </button>
            <button onClick={save} disabled={!name.trim() || saving}
              className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white py-2.5 rounded-xl font-semibold transition-colors">
              {saving ? 'Saving…' : editId ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)}
          className="w-full bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-2xl font-semibold text-lg transition-colors">
          + Add Child
        </button>
      )}
    </div>
  )
}
