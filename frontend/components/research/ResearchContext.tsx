"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPortfolios, fetchPortfolioDetail } from "@/lib/api";
import type { PortfolioDetail, PortfolioSummary } from "@/types/sprint3";

const LS_KEY = "be_research_portfolio_id";

interface ResearchContextValue {
  portfolioId: string | null;
  setPortfolioId: (id: string) => void;
  portfolioDetail: PortfolioDetail | null;
  portfolios: PortfolioSummary[];
  isLoading: boolean;
}

const ResearchContext = createContext<ResearchContextValue>({
  portfolioId: null,
  setPortfolioId: () => {},
  portfolioDetail: null,
  portfolios: [],
  isLoading: true,
});

export function useResearch() {
  return useContext(ResearchContext);
}

export function ResearchProvider({ children }: { children: React.ReactNode }) {
  const [portfolioId, setPortfolioIdRaw] = useState<string | null>(null);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) setPortfolioIdRaw(saved);
  }, []);

  const setPortfolioId = (id: string) => {
    setPortfolioIdRaw(id);
    localStorage.setItem(LS_KEY, id);
  };

  // Fetch portfolio list
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ["portfolios"],
    queryFn: fetchPortfolios,
    staleTime: 30_000,
  });

  const portfolios = listData?.portfolios ?? [];

  // Auto-select first portfolio if none selected
  useEffect(() => {
    if (!portfolioId && portfolios.length > 0) {
      setPortfolioId(portfolios[0].id);
    }
  }, [portfolios, portfolioId]);

  // Fetch selected portfolio detail
  const { data: portfolioDetail, isLoading: detailLoading } = useQuery({
    queryKey: ["portfolio", portfolioId],
    queryFn: () => fetchPortfolioDetail(portfolioId!),
    enabled: !!portfolioId,
    staleTime: 30_000,
  });

  return (
    <ResearchContext.Provider
      value={{
        portfolioId,
        setPortfolioId,
        portfolioDetail: portfolioDetail ?? null,
        portfolios,
        isLoading: listLoading || detailLoading,
      }}
    >
      {children}
    </ResearchContext.Provider>
  );
}
