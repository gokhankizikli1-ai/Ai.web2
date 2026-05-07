import { Routes, Route } from 'react-router';
import LandingPage from './pages/LandingPage';
import ChatDashboard from './pages/ChatDashboard';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/chat" element={<ChatDashboard />} />
    </Routes>
  );
}
