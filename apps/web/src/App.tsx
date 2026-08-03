import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { CompareProductPage } from './pages/CompareProductPage';
import { DashboardPage } from './pages/DashboardPage';
import { HomePage } from './pages/HomePage';
import { MatchReviewPage } from './pages/MatchReviewPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProductDetailsPage } from './pages/ProductDetailsPage';
import { SearchResultsPage } from './pages/SearchResultsPage';
import { SettingsPage } from './pages/SettingsPage';
import { WatchlistPage } from './pages/WatchlistPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/search" element={<SearchResultsPage />} />
        <Route path="/products/:id" element={<ProductDetailsPage />} />
        {/* One product, every store that sells it. */}
        <Route path="/compare/:id" element={<CompareProductPage />} />
        <Route path="/watchlist" element={<WatchlistPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {/*
          Internal. Deliberately absent from the main navigation — see the
          banner on the page itself — but a real route, so it is linkable,
          bookmarkable and testable like anything else.
        */}
        <Route path="/admin/match-review" element={<MatchReviewPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
