import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { IslandShell } from './components/layout/IslandShell';
import { HomePage } from './pages/HomePage';
import { ImportPage } from './pages/ImportPage';
import { PaperStudyPage } from './pages/PaperStudyPage';
import { GlobalVocabPage } from './pages/GlobalVocabPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  return (
    <BrowserRouter>
      <IslandShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/import" element={<ImportPage />} />
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
