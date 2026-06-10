package com.workoutlogger.domain;

/** Rep/RIR (and optional %1RM) prescription for a block. %1RM bounds are STRINGS (decimals-as-strings). */
public record IntensityBand(int repLow, int repHigh, String targetRir, String pctLow, String pctHigh) {}
