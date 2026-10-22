import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ModelsPage } from './pages/ModelsPage';
import { NewEvaluationPage } from './pages/NewEvaluationPage';
import { ProjectPage } from './pages/ProjectPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { RunPage } from './pages/RunPage';

function NotFound() {
  return (
    <div className="empty">
      <h3>That page does not exist</h3>
      <Link to="/" className="btn btn-secondary">Back to projects</Link>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ProjectsPage />} />
        <Route path="new" element={<NewEvaluationPage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="projects/:id" element={<ProjectPage />} />
        <Route path="runs/:id" element={<RunPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
