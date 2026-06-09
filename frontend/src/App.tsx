import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useAuth } from "./auth/auth";
import LoginPage from "./pages/LoginPage";
import WorkoutsPage from "./pages/WorkoutsPage";
import WorkoutDetailPage from "./pages/WorkoutDetailPage";
import EditWorkoutPage from "./pages/EditWorkoutPage";
import ExerciseListPage from "./pages/ExerciseListPage";
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
  const nav = useNavigate();
  return (
    <div className="app">
      <header className="topbar">
        <Brand />
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => nav("/exercise-list")}>Exercises</button>
          <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <Routes>
        <Route path="/previous-workouts" element={<WorkoutsPage />} />
        <Route path="/previous-workouts/:id" element={<WorkoutDetailPage />} />
        <Route path="/previous-workouts/:id/edit" element={<EditWorkoutPage />} />
        <Route path="/exercise-list" element={<ExerciseListPage />} />
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
