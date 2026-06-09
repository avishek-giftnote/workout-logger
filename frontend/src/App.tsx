import { useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useAuth } from "./auth/auth";
import SettingsSidebar from "./components/SettingsSidebar";
import LoginPage from "./pages/LoginPage";
import WorkoutsPage from "./pages/WorkoutsPage";
import WorkoutDetailPage from "./pages/WorkoutDetailPage";
import EditWorkoutPage from "./pages/EditWorkoutPage";
import ExerciseListPage from "./pages/ExerciseListPage";
import ExerciseDetailPage from "./pages/ExerciseDetailPage";
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
  const nav = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <div className="app">
      <header className="topbar">
        <Brand />
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => nav("/exercise-list")}>Exercises</button>
          <button className="btn btn-ghost" title="Settings" onClick={() => setSettingsOpen(true)}>⚙</button>
        </div>
      </header>
      <Routes>
        <Route path="/previous-workouts" element={<WorkoutsPage />} />
        <Route path="/previous-workouts/:id" element={<WorkoutDetailPage />} />
        <Route path="/previous-workouts/:id/edit" element={<EditWorkoutPage />} />
        <Route path="/exercise-list" element={<ExerciseListPage />} />
        <Route path="/exercise-list/:id" element={<ExerciseDetailPage />} />
        <Route path="/start" element={<LogWorkoutPage />} />
        <Route path="*" element={<Navigate to="/previous-workouts" replace />} />
      </Routes>
      <SettingsSidebar open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default function App() {
  const { isAuthed } = useAuth();
  return isAuthed ? <Shell /> : <LoginPage />;
}
