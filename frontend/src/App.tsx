import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/auth";
import LoginPage from "./pages/LoginPage";
import WorkoutsPage from "./pages/WorkoutsPage";
import LogWorkoutPage from "./pages/LogWorkoutPage";

function Brand() {
  return (
    <div className="brand">
      <div className="mark" />
      <b>WORKOUT<span>·</span>LOGGER</b>
    </div>
  );
}

function Shell() {
  const { signOut } = useAuth();
  return (
    <div className="app">
      <header className="topbar">
        <Brand />
        <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
      </header>
      <Routes>
        <Route path="/" element={<WorkoutsPage />} />
        <Route path="/log" element={<LogWorkoutPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default function App() {
  const { isAuthed } = useAuth();
  return isAuthed ? <Shell /> : <LoginPage />;
}
