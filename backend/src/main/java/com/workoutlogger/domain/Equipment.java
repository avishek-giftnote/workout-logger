package com.workoutlogger.domain;

/**
 * Strength-training equipment. BODYWEIGHT replaces the need for a separate assisted/weighted
 * distinction — the weight field carries the added/assist load. (Cardio modalities come later.)
 */
public enum Equipment {
    DUMBBELL,
    BARBELL,
    SMITH_MACHINE,
    KETTLEBELL,
    MACHINE,
    CABLE,
    BODYWEIGHT,
    OTHER
}
