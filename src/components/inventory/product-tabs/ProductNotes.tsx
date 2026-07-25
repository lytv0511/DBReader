import { useState, useEffect } from "react";
import { Plus, Pin, PinOff, Trash2, Save, X, MessageSquare } from "lucide-react";
import { executeQuery, upsertProductNote, deleteProductNote } from "../../../lib/db";

interface Note {
  id: number;
  product_id: number;
  title: string;
  body: string;
  is_pinned: number;
  created_at: string;
  updated_at: string;
}

interface ProductNotesProps {
  productId: number;
}

export default function ProductNotes({ productId }: ProductNotesProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newPinned, setNewPinned] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotes = async () => {
    try {
      const result = await executeQuery(
        `SELECT id, product_id, title, body, is_pinned, created_at, updated_at FROM product_notes WHERE product_id = ${productId} ORDER BY is_pinned DESC, created_at DESC`
      );
      setNotes(result.rows.map((r) => ({
        id: r[0] as number, product_id: r[1] as number, title: r[2] as string,
        body: r[3] as string, is_pinned: r[4] as number, created_at: r[5] as string, updated_at: r[6] as string,
      })));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    fetchNotes();
    setNewTitle('');
    setNewBody('');
    setNewPinned(false);
    setShowNewForm(false);
    setExpandedId(null);
    setError(null);
  }, [productId]);

  const handleExpand = (note: Note) => {
    if (expandedId === note.id) {
      setExpandedId(null);
    } else {
      setExpandedId(note.id);
      setEditTitle(note.title ?? "");
      setEditBody(note.body ?? "");
    }
  };

  const handleSaveEdit = async (note: Note) => {
    try {
      await upsertProductNote(
        productId,
        editTitle,
        editBody,
        note.is_pinned === 1,
        note.id
      );
      setExpandedId(null);
      fetchNotes();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleTogglePin = async (note: Note) => {
    try {
      await upsertProductNote(
        productId,
        note.title ?? "",
        note.body ?? "",
        note.is_pinned !== 1,
        note.id
      );
      fetchNotes();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDelete = async (noteId: number) => {
    try {
      await deleteProductNote(noteId);
      if (expandedId === noteId) setExpandedId(null);
      fetchNotes();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleCreate = async () => {
    if (!newBody.trim()) return;
    try {
      await upsertProductNote(productId, newTitle, newBody, newPinned);
      setNewTitle("");
      setNewBody("");
      setNewPinned(false);
      setShowNewForm(false);
      fetchNotes();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-text-primary font-semibold flex items-center gap-2">
          <MessageSquare size={18} />
          Notes
          <span className="text-text-secondary text-sm font-normal">({notes.length})</span>
        </h3>
        <button
          onClick={() => setShowNewForm(!showNewForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent/10 text-accent hover:bg-accent/20 text-sm transition-colors"
        >
          <Plus size={16} />
          New Note
        </button>
      </div>

      {showNewForm && (
        <div className="p-4 border-b border-border bg-bg-primary">
          {error && <div className="mb-2 p-2 bg-error/10 border border-error/20 rounded text-xs text-error">{error}</div>}
          <input
            type="text"
            placeholder="Title (optional)"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="w-full px-3 py-2 mb-2 rounded-md bg-bg-secondary border border-border text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent"
          />
          <textarea
            placeholder="Write your note..."
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 mb-3 rounded-md bg-bg-secondary border border-border text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent resize-none"
          />
          <div className="flex items-center justify-between">
            <button
              onClick={() => setNewPinned(!newPinned)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                newPinned
                  ? "bg-accent/20 text-accent"
                  : "bg-bg-secondary text-text-secondary hover:text-text-primary border border-border"
              }`}
            >
              {newPinned ? <Pin size={14} /> : <PinOff size={14} />}
              {newPinned ? "Pinned" : "Pin"}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setShowNewForm(false);
                  setNewTitle("");
                  setNewBody("");
                  setNewPinned(false);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bg-secondary text-text-secondary hover:text-text-primary border border-border text-sm transition-colors"
              >
                <X size={14} />
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newBody.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent/90 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Save size={14} />
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {error && !notes.length && (
          <div className="p-4 text-xs text-error">{error}</div>
        )}
        {notes.length === 0 && !error ? (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary">
            <MessageSquare size={40} className="mb-3 opacity-40" />
            <p>No notes yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notes.map((note) => (
              <div key={note.id} className="bg-bg-primary hover:bg-bg-hover transition-colors">
                {expandedId === note.id ? (
                  <div className="p-4">
                    <input
                      type="text"
                      placeholder="Title (optional)"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full px-3 py-2 mb-2 rounded-md bg-bg-secondary border border-border text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent"
                    />
                    <textarea
                      placeholder="Write your note..."
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={6}
                      className="w-full px-3 py-2 mb-3 rounded-md bg-bg-secondary border border-border text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent resize-none"
                    />
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleTogglePin(note)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                            note.is_pinned === 1
                              ? "bg-accent/20 text-accent"
                              : "bg-bg-secondary text-text-secondary hover:text-text-primary border border-border"
                          }`}
                        >
                          {note.is_pinned === 1 ? <Pin size={14} /> : <PinOff size={14} />}
                          {note.is_pinned === 1 ? "Pinned" : "Pin"}
                        </button>
                        <button
                          onClick={() => handleDelete(note.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bg-secondary text-red-400 hover:bg-red-500/10 border border-border text-sm transition-colors"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExpandedId(null)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bg-secondary text-text-secondary hover:text-text-primary border border-border text-sm transition-colors"
                        >
                          <X size={14} />
                          Cancel
                        </button>
                        <button
                          onClick={() => handleSaveEdit(note)}
                          disabled={!editBody.trim()}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent/90 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Save size={14} />
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => handleExpand(note)}
                    className="w-full text-left p-4 flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-text-primary font-medium truncate">
                          {note.title || "Untitled"}
                        </span>
                        {note.is_pinned === 1 && (
                          <span className="flex items-center gap-1 text-xs text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                            <Pin size={10} />
                            Pinned
                          </span>
                        )}
                      </div>
                      <p className="text-text-secondary text-sm truncate">
                        {note.body?.length > 80 ? note.body.substring(0, 80) + "..." : note.body}
                      </p>
                      <span className="text-text-secondary text-xs mt-1 block">
                        {new Date(note.created_at).toLocaleString()}
                      </span>
                    </div>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
