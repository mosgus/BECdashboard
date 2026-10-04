import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Header } from './components/Header'
import { TickerStrip } from './components/TickerStrip'
import { AnalysisLayout } from './pages/analysis/AnalysisLayout'
import { HoldingsPage } from './pages/analysis/HoldingsPage'
import { OptimizePage } from './pages/analysis/OptimizePage'
import { OutlookPage } from './pages/analysis/OutlookPage'
import { RiskPage } from './pages/analysis/RiskPage'
import { LaunchPage } from './pages/LaunchPage'
import { OpsPage } from './pages/OpsPage'
import { PortfoliosPage } from './pages/PortfoliosPage'
import { TickerPage } from './pages/TickerPage'
import { UniversePage } from './pages/UniversePage'

export default function App() {
  return (
    <BrowserRouter>
      <Header />
      <TickerStrip />
      <Routes>
        <Route path="/" element={<LaunchPage />} />
        <Route path="/universe" element={<UniversePage />} />
        <Route path="/ticker/:symbol" element={<TickerPage />} />
        <Route path="/ops" element={<OpsPage />} />
        <Route path="/portfolios" element={<PortfoliosPage />} />
        <Route path="/portfolios/:portfolioId" element={<AnalysisLayout />}>
          <Route index element={<Navigate to="holdings" replace />} />
          <Route path="holdings" element={<HoldingsPage />} />
          <Route path="optimize" element={<OptimizePage />} />
          <Route path="outlook" element={<OutlookPage />} />
          <Route path="monitor" element={<Navigate to="../holdings" replace />} />
          <Route path="risk" element={<RiskPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
