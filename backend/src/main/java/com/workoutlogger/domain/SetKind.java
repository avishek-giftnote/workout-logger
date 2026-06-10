package com.workoutlogger.domain;

/** Discriminates a logged set's modality. Absent/null on the 1,533 imported rows ⇒ treat as STRENGTH. */
public enum SetKind {
    STRENGTH,
    CARDIO
}
