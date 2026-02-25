"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import {
  createPortfolio,
  deletePortfolio,
  fetchPortfolios,
} from "@/lib/api";
import { PortfolioSummary } from "@/types/sprint3";

export default function PortfoliosPage() {
  const { checked } = useAuth();
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["portfolios"],
    queryFn: fetchPortfolios,
    enabled: checked,
  });

  const createMut = useMutation({
    mutationFn: (name: string) => createPortfolio(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolios"] });
      setNewName("");
      setCreateError(null);
    },
    onError: (e: Error) => setCreateError(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePortfolio(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolios"] });
      setConfirmDelete(null);
    },
  });

  if (!checked) return null;

  const portfolios: PortfolioSummary[] = data?.portfolios ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">Portfolios</h1>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            Create portfolios from your universe, then run analytics and optimization.
          </p>
        </div>
      </div>

      {/* Create form */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">New Portfolio</h2>
        <div className="flex gap-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) createMut.mutate(newName.trim());
            }}
            placeholder="Portfolio name, e.g. Core Holdings"
            className="flex-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
          <button
            onClick={() => newName.trim() && createMut.mutate(newName.trim())}
            disabled={!newName.trim() || createMut.isPending}
            className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {createMut.isPending ? "Creating…" : "Create"}
          </button>
        </div>
        {createError && <p className="mt-2 text-xs text-[var(--color-negative)]">{createError}</p>}
      </div>

      {/* Portfolio grid */}
      {isLoading ? (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      ) : portfolios.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-12 text-center">
          <p className="text-sm text-[var(--color-muted)]">No portfolios yet.</p>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            Create one above, then add holdings from your Universe.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {portfolios.map((p) => (
            <div
              key={p.id}
              className="group relative rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm hover:border-[var(--color-primary)] transition-colors"
            >
              <Link href={`/portfolios/${p.id}`} className="block">
                <p className="font-semibold text-[var(--color-text)] group-hover:text-[var(--color-primary)]">
                  {p.name}
                </p>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  {p.position_count} holding{p.position_count !== 1 ? "s" : ""}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                  Created {new Date(p.created_at).toLocaleDateString()}
                </p>
              </Link>

              {/* Delete controls */}
              <div className="mt-4 flex justify-end">
                {confirmDelete === p.id ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => deleteMut.mutate(p.id)}
                      disabled={deleteMut.isPending}
                      className="rounded px-2 py-1 text-xs font-medium text-[var(--color-negative)] hover:bg-red-50"
                    >
                      Yes, delete
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="rounded px-2 py-1 text-xs font-medium text-[var(--color-muted)] hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.preventDefault(); setConfirmDelete(p.id); }}
                    className="text-xs text-[var(--color-muted)] hover:text-[var(--color-negative)] transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
