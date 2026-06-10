package com.workoutlogger.domain;

/** Which cardio inputs a CARDIO exercise logs. Null/empty on the catalog ⇒ the client default set. */
public enum CardioMetric {
    DISTANCE,
    DURATION,
    PACE,        // derived pace/speed readout from distance + duration
    GRADE,       // treadmill continuous incline %
    ELEVATION,   // outdoor cumulative gain (m)
    CADENCE      // steps/rpm/strokes per minute
}
