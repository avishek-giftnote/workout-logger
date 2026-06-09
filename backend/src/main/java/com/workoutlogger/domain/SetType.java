package com.workoutlogger.domain;

/**
 * The role of a logged set. Strong's "Set Order" column conflates position and type
 * ('W' for warmup, 1..N for working); we split it into {@code orderIndex} + this enum.
 * DROP/FAILURE are not present in the imported data but are modelled for live logging.
 */
public enum SetType {
    WARMUP,
    WORKING,
    DROP,
    FAILURE
}
