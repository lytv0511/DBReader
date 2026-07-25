import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  Save,
  X,
  Tag,
  AlertTriangle,
} from "lucide-react";
import {
  upsertProductAttribute,
  getCategoryTemplates,
  executeQuery,
} from "../../../lib/db";

interface ProductAttribute {
  id: number;
  product_id: number;
  key: string;
  value: string;
  type: string;
}

interface CategoryTemplate {
  id: number;
  category_id: number;
  key: string;
  type: string;
}

interface ProductFieldsProps {
  productId: number;
  categoryId: number | null;
}

const ATTRIBUTE_TYPES = ["string", "number", "boolean", "date", "url"] as const;

export default function ProductFields({
  productId,
  categoryId,
}: ProductFieldsProps) {
  const [attributes, setAttributes] = useState<ProductAttribute[]>([]);
  const [templates, setTemplates] = useState<CategoryTemplate[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    key: "",
    value: "",
    type: "string",
  });
  const [newField, setNewField] = useState({ key: "", value: "", type: "string" });
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const clearMessages = useCallback(() => {
    setSuccessMsg("");
    setErrorMsg("");
  }, []);

  const fetchAttributes = useCallback(async () => {
    try {
      const result = await executeQuery(
        `SELECT id, product_id, attr_key as key, attr_value as value, data_type as type FROM product_attributes WHERE product_id = ${productId} ORDER BY id`
      );
      setAttributes(result.rows.map((r) => ({
        id: r[0] as number, product_id: r[1] as number, key: r[2] as string,
        value: r[3] as string, type: r[4] as string,
      })));
    } catch {
      setErrorMsg("Failed to load attributes");
    }
  }, [productId]);

  const fetchTemplates = useCallback(async () => {
    if (!categoryId) {
      setTemplates([]);
      return;
    }
    try {
      const result = await getCategoryTemplates(categoryId);
      setTemplates(result.map((r) => ({
        id: r.id as number, category_id: categoryId, key: (r.attr_key ?? r.key) as string, type: (r.attr_type ?? r.type) as string,
      })));
    } catch {
      setErrorMsg("Failed to load category templates");
    }
  }, [categoryId]);

  useEffect(() => {
    fetchAttributes();
  }, [fetchAttributes]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  useEffect(() => {
    if (successMsg || errorMsg) {
      const timer = setTimeout(clearMessages, 3000);
      return () => clearTimeout(timer);
    }
  }, [successMsg, errorMsg, clearMessages]);

  const usedTemplateKeys = new Set(
    attributes.map((a) => a.key.toLowerCase())
  );

  const startEdit = (attr: ProductAttribute) => {
    setEditingId(attr.id);
    setEditForm({ key: attr.key, value: attr.value, type: attr.type });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ key: "", value: "", type: "string" });
  };

  const saveEdit = async () => {
    if (!editForm.key.trim()) {
      setErrorMsg("Key is required");
      return;
    }
    try {
      await upsertProductAttribute(
        productId,
        editForm.key.trim(),
        editForm.value,
        editForm.type
      );
      setEditingId(null);
      setSuccessMsg("Attribute saved");
      fetchAttributes();
    } catch {
      setErrorMsg("Failed to save attribute");
    }
  };

  const deleteAttribute = async (id: number) => {
    try {
      await executeQuery(
        `DELETE FROM product_attributes WHERE id = ${id}`
      );
      setAttributes((prev) => prev.filter((a) => a.id !== id));
      setSuccessMsg("Attribute deleted");
    } catch {
      setErrorMsg("Failed to delete attribute");
    }
  };

  const addNewField = async () => {
    if (!newField.key.trim()) {
      setErrorMsg("Key is required");
      return;
    }
    try {
      await upsertProductAttribute(
        productId,
        newField.key.trim(),
        newField.value,
        newField.type
      );
      setNewField({ key: "", value: "", type: "text" });
      setSuccessMsg("Attribute added");
      fetchAttributes();
    } catch {
      setErrorMsg("Failed to add attribute");
    }
  };

  const addFromTemplate = (template: CategoryTemplate) => {
    setNewField({
      key: template.key,
      value: "",
      type: template.type,
    });
  };

  const removeAllAttributes = async () => {
    try {
      for (const attr of attributes) {
        await executeQuery(
          `DELETE FROM product_attributes WHERE id = ${attr.id}`
        );
      }
      setAttributes([]);
      setShowDeleteAllConfirm(false);
      setSuccessMsg("All attributes removed");
    } catch {
      setErrorMsg("Failed to remove attributes");
    }
  };

  return (
    <div className="space-y-6">
      {successMsg && (
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-2 text-sm text-success">
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-2 text-sm text-error">
          {errorMsg}
        </div>
      )}

      {categoryId && templates.length > 0 && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-secondary">
            <Tag size={14} />
            Category Templates
          </h3>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => {
              const alreadyUsed = usedTemplateKeys.has(t.key.toLowerCase());
              return (
                <button
                  key={t.id}
                  disabled={alreadyUsed}
                  onClick={() => addFromTemplate(t)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    alreadyUsed
                      ? "cursor-not-allowed border-border text-text-secondary/40"
                      : "cursor-pointer border-accent/30 bg-accent/10 text-accent hover:bg-accent/20"
                  }`}
                >
                  <Plus size={12} />
                  {t.key}
                  <span className="text-text-secondary/60">({t.type})</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-text-secondary">
          Current Fields
        </h3>
        {attributes.length === 0 && (
          <p className="text-sm text-text-secondary/60">
            No attributes yet. Add one below or from a template.
          </p>
        )}
        <div className="space-y-2">
          {attributes.map((attr) => {
            const isEditing = editingId === attr.id;
            return (
              <div
                key={attr.id}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
                  isEditing
                    ? "border-accent/40 bg-accent/5"
                    : "border-border bg-bg-secondary hover:bg-bg-hover"
                }`}
              >
                {isEditing ? (
                  <>
                    <input
                      className="w-32 rounded border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary outline-none focus:border-accent"
                      value={editForm.key}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, key: e.target.value }))
                      }
                      placeholder="Key"
                    />
                    <input
                      className="flex-1 rounded border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary outline-none focus:border-accent"
                      value={editForm.value}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, value: e.target.value }))
                      }
                      placeholder="Value"
                    />
                    <select
                      className="rounded border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary outline-none focus:border-accent"
                      value={editForm.type}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, type: e.target.value }))
                      }
                    >
                      {ATTRIBUTE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => saveEdit()}
                      className="rounded p-1.5 text-success transition-colors hover:bg-success/10"
                      title="Save"
                    >
                      <Save size={14} />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="rounded p-1.5 text-text-secondary transition-colors hover:bg-bg-hover"
                      title="Cancel"
                    >
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="w-32 truncate text-sm font-medium text-text-primary">
                      {attr.key}
                    </span>
                    <span className="flex-1 truncate text-sm text-text-secondary">
                      {attr.value || "—"}
                    </span>
                    <span className="rounded bg-bg-primary px-1.5 py-0.5 text-xs text-text-secondary">
                      {attr.type}
                    </span>
                    <button
                      onClick={() => startEdit(attr)}
                      className="rounded p-1.5 text-accent transition-colors hover:bg-accent/10"
                      title="Edit"
                    >
                      <Save size={14} />
                    </button>
                    <button
                      onClick={() => deleteAttribute(attr.id)}
                      className="rounded p-1.5 text-error transition-colors hover:bg-error/10"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-text-secondary">
          Add New Field
        </h3>
        <div className="flex items-center gap-2">
          <input
            className="w-32 rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            value={newField.key}
            onChange={(e) =>
              setNewField((f) => ({ ...f, key: e.target.value }))
            }
            placeholder="Key"
          />
          <input
            className="flex-1 rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            value={newField.value}
            onChange={(e) =>
              setNewField((f) => ({ ...f, value: e.target.value }))
            }
            placeholder="Value"
          />
          <select
            className="rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            value={newField.type}
            onChange={(e) =>
              setNewField((f) => ({ ...f, type: e.target.value }))
            }
          >
            {ATTRIBUTE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            onClick={addNewField}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg-primary transition-colors hover:bg-accent/80"
          >
            <Plus size={14} />
            Add
          </button>
        </div>
      </section>

      {attributes.length > 0 && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-warning">
            <AlertTriangle size={14} />
            Danger Zone
          </h3>
          {showDeleteAllConfirm ? (
            <div className="flex items-center gap-3 rounded-lg border border-error/30 bg-error/5 px-4 py-3">
              <span className="text-sm text-text-primary">
                Remove all {attributes.length} attributes?
              </span>
              <button
                onClick={removeAllAttributes}
                className="rounded-lg bg-error px-3 py-1.5 text-sm font-medium text-bg-primary transition-colors hover:bg-error/80"
              >
                Confirm
              </button>
              <button
                onClick={() => setShowDeleteAllConfirm(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-hover"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowDeleteAllConfirm(true)}
              className="flex items-center gap-1.5 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm font-medium text-error transition-colors hover:bg-error/20"
            >
              <Trash2 size={14} />
              Remove all attributes
            </button>
          )}
        </section>
      )}
    </div>
  );
}
