import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { IslandShell } from './components/layout/IslandShell';
import { HomePage } from './pages/HomePage';
import { ImportPage } from './pages/ImportPage';
import { OcrWorkingPage } from './pages/OcrWorkingPage';
import { PaperStudyPage } from './pages/PaperStudyPage';
import { GlobalVocabPage } from './pages/GlobalVocabPage';
import { SettingsPage } from './pages/SettingsPage';

function ScrollToTopOnPathChange() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollToTopOnPathChange />
      <IslandShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/import/ocr" element={<OcrWorkingPage />} />
          <Route path="/paper/:id" element={<PaperStudyPage />} />
          <Route path="/vocab" element={<GlobalVocabPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </IslandShell>
    </BrowserRouter>
  );
}

export default App;
