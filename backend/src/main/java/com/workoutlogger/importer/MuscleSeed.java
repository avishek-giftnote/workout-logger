package com.workoutlogger.importer;

import com.workoutlogger.domain.MuscleContribution;

import java.math.BigDecimal;
import java.util.List;

import static com.workoutlogger.domain.Muscle.*;

/**
 * Keyword-based seed of which muscles an exercise works, inferred from its name. Used to fill
 * {@code Exercise.muscleContributions} on read when the user hasn't set them. Rules run most-specific
 * first; an unrecognized name returns an empty list (the UI flags it as unmapped). See docs/coach.md.
 */
public final class MuscleSeed {

    private MuscleSeed() {}

    private static MuscleContribution mc(com.workoutlogger.domain.Muscle m, String f) {
        return new MuscleContribution(m, new BigDecimal(f));
    }
    private static boolean has(String n, String... kws) {
        for (String k : kws) if (n.contains(k)) return true;
        return false;
    }

    public static List<MuscleContribution> infer(String name) {
        String n = name == null ? "" : name.toLowerCase();
        if (has(n, "treadmill", "running", "cycl", "swim", "ellipt", "jog", "sprint")) return List.of(); // cardio (avoid bare "run" — matches "crunch")
        if (has(n, "crunch", "sit up", "sit-up", "knee raise", "leg raise", "plank", "ab wheel")) return List.of(mc(ABS, "1.0"));
        if (has(n, "wrist", "forearm")) return List.of(mc(FOREARM, "1.0"));
        if (has(n, "calf")) return List.of(mc(CALF, "1.0"));
        if (has(n, "external rotation", "face pull")) return List.of(mc(REAR_DELT, "1.0"), mc(UPPER_BACK, "0.5"));
        if (has(n, "lateral raise", "lu raise", "side raise")) return List.of(mc(SIDE_DELT, "1.0"));
        if (has(n, "reverse fly", "rear delt", "rear-delt")) return List.of(mc(REAR_DELT, "1.0"), mc(UPPER_BACK, "0.5"));
        if (has(n, "pec deck", "chest fly", "cable fly", "dumbbell fly", "pec ")) return List.of(mc(CHEST, "1.0"), mc(FRONT_DELT, "0.3"));
        if (has(n, "bench press", "incline press", "chest press", "incline bench", "decline press")) return List.of(mc(CHEST, "1.0"), mc(FRONT_DELT, "0.5"), mc(TRICEP, "0.5"));
        if (has(n, "overhead press", "shoulder press", "military", "ohp")) return List.of(mc(FRONT_DELT, "1.0"), mc(SIDE_DELT, "0.5"), mc(TRICEP, "0.5"));
        if (has(n, "tricep", "pushdown", "skullcrusher", "skull crusher")) return List.of(mc(TRICEP, "1.0"));
        if (has(n, "leg curl", "lying curl")) return List.of(mc(HAMSTRING, "1.0"));
        if (has(n, "preacher", "hammer curl")) return List.of(mc(BICEP, "1.0"), mc(FOREARM, "0.5"));
        if (has(n, "curl") && !has(n, "wrist", "leg")) return List.of(mc(BICEP, "1.0"));
        if (has(n, "pulldown", "pull up", "pull-up", "pullup", "chin up", "chin-up", "chinup")) return List.of(mc(LAT, "1.0"), mc(BICEP, "0.5"), mc(UPPER_BACK, "0.5"));
        if (has(n, "row")) return List.of(mc(LAT, "1.0"), mc(UPPER_BACK, "0.5"), mc(BICEP, "0.5"));
        if (has(n, "romanian deadlift", "rdl", "good morning", "stiff leg", "stiff-leg")) return List.of(mc(HAMSTRING, "1.0"), mc(GLUTE, "0.5"));
        if (has(n, "deadlift")) return List.of(mc(HAMSTRING, "0.75"), mc(GLUTE, "0.75"), mc(UPPER_BACK, "0.5"));
        if (has(n, "hip thrust", "glute bridge")) return List.of(mc(GLUTE, "1.0"), mc(HAMSTRING, "0.5"));
        if (has(n, "abductor", "abduction")) return List.of(mc(GLUTE, "1.0"));
        if (has(n, "leg extension")) return List.of(mc(QUAD, "1.0"));
        if (has(n, "leg press")) return List.of(mc(QUAD, "1.0"), mc(GLUTE, "0.5"));
        if (has(n, "squat", "lunge", "split squat", "step up", "step-up")) return List.of(mc(QUAD, "1.0"), mc(GLUTE, "0.5"), mc(HAMSTRING, "0.3"));
        return List.of();
    }
}
