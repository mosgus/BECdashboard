"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ChevronRight, List } from "lucide-react";
import { createWatchlist, deleteWatchlist, fetchWatchlists } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import type { WatchlistSummary } from "@/types/sprint2";

export default function WatchlistsPage() {
  const { checked } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["watchlists"],
    queryFn: fetchWatchlists,
  });

  const createMutation = useMutation({
    mutationFn: () => createWatchlist(newName.trim()),
    onSuccess: (wl) => {
      setNewName("");
      qc.invalidateQueries({ queryKey: ["watchlists"] });
      router.push(`/watchlists/${wl.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteWatchlist(id),
    onSuccess: () => {
      setDeleteConfirm(null);
      qc.invalidateQueries({ queryKey: ["watchlists"] });
    },
  });

  if (!checked) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-[var(--color-text)]">Watchlists</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Create named lists of tickers to track signals together.
        </p>
      </div>

      {/* Create form */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">New Watchlist</h2>
        <div className="flex gap-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && newName.trim() && createMutation.mutate()}
            placeholder="e.g. Tech Leaders"
            className="flex-1 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
          <button
            onClick={() => createMutation.mutate()}
            disabled={!newName.trim() || createMutation.isPending}
            className="flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <Plus size={14} />
            Create
          </button>
        </div>
        {createMutation.error && (
          <p className="mt-2 text-xs text-[var(--color-negative)]">
            {(createMutation.error as Error).message}
          </p>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      ) : !data?.watchlists.length ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-12 text-center text-[var(--color-muted)]">
          <List size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No watchlists yet.</p>
          <p className="mt-1 text-xs">Create one above to get started.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.watchlists.map((wl: WatchlistSummary) => (
            <div
              key={wl.id}
              className="group relative rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm hover:border-[var(--color-primary)] transition-colors cursor-pointer"
              onClick={() => {
                if (deleteConfirm !== wl.id) router.push(`/watchlists/${wl.id}`);
              }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-[var(--color-text)]">{wl.name}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                    {wl.item_count} ticker{wl.item_count !== 1 ? "s" : ""} ·{" "}
                    {wl.created_at.slice(0, 10)}
                  </p>
                </div>
                <ChevronRight
                  size={16}
                  className="mt-0.5 text-[var(--color-muted)] group-hover:text-[var(--color-primary)] transition-colors"
                />
              </div>

              {/* Delete */}
              <div className="mt-3 flex justify-end">
                {deleteConfirm === wl.id ? (
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <span className="text-xs text-[var(--color-muted)]">Delete?</span>
                    <button
                      onClick={() => deleteMutation.mutate(wl.id)}
                      className="text-xs font-semibold text-[var(--color-negative)] hover:opacity-80"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm(wl.id);
                    }}
                    className="text-[var(--color-muted)] hover:text-[var(--color-negative)] transition-colors"
                    title="Delete watchlist"
                  >
                    <Trash2 size={14} />
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
