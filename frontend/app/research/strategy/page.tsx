"use client";
import ComingSoonCard from "@/components/research/ComingSoonCard";

export default function StrategyResearchPage() {
  return (
    <ComingSoonCard
      title="Strategy Research"
      description="Validate trading signals and investment rules with rigorous statistical testing before committing capital."
      features={[
        "Hypothesis definition and investment thesis documentation",
        "Signal diagnostics: IC, rank IC, t-stats, hit rate, monotonicity",
        "Walk-forward testing with train/validate/test splits",
        "Decile spread charts and IC time series",
        "Economic realism: turnover, capacity, trading costs, slippage",
        "Failure analysis: regime dependency, factor overlap, sample sensitivity",
      ]}
    />
  );
}
