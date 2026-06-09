import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useAuth } from "./auth/auth";
import LoginPage from "./pages/LoginPage";
import WorkoutsPage from "./pages/WorkoutsPage";
import WorkoutDetailPage from "./pages/WorkoutDetailPage";
import LogWorkoutPage from "./pages/LogWorkoutPage";

function Brand() {
  const nav = useNavigate();
  return (
    <div className="brand" style={{ cursor: "pointer" }} onClick={() => nav("/previous-workouts")}>
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
        <Route path="/previous-workouts" element={<WorkoutsPage />} />
        <Route path="/previous-workouts/:id" element={<WorkoutDetailPage />} />
        <Route path="/start" element={<LogWorkoutPage />} />
        <Route path="*" element={<Navigate to="/previous-workouts" replace />} />
      </Routes>
    </div>
  );
}

export default function App() {
  const { isAuthed } = useAuth();
  return isAuthed ? <Shell /> : <LoginPage />;
}
