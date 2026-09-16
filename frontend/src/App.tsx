import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Header } from './components/Header'
import { TickerStrip } from './components/TickerStrip'
import { LaunchPage } from './pages/LaunchPage'
import { UniversePage } from './pages/UniversePage'

export default function App() {
  return (
    <BrowserRouter>
      <Header />
      <TickerStrip />
      <Routes>
        <Route path="/" element={<LaunchPage />} />
        <Route path="/universe" element={<UniversePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
