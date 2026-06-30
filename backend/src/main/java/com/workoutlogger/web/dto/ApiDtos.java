package com.workoutlogger.web.dto;

import com.workoutlogger.domain.ActivityLevel;
import com.workoutlogger.domain.BlockType;
import com.workoutlogger.domain.CardioMetric;
import com.workoutlogger.domain.CyclePhase;
import com.workoutlogger.domain.Equipment;
import com.workoutlogger.domain.ExerciseCategory;
import com.workoutlogger.domain.Goal;
import com.workoutlogger.domain.Laterality;
import com.workoutlogger.domain.LoadMode;
import com.workoutlogger.domain.Mechanic;
import com.workoutlogger.domain.Muscle;
import com.workoutlogger.domain.Sex;
import com.workoutlogger.domain.SetKind;
import com.workoutlogger.domain.SetType;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * API request/response shapes. NOTE: all weights are exact decimals carried as STRINGS
 * (DESIGN.md §3.1) so a JS-number client cannot silently round the fractional-kg values.
 */
public final class ApiDtos {

    private ApiDtos() {}

    // ---- exercises ----
    public record MuscleContributionDto(Muscle muscle, String fraction) {}

    public record ExerciseDto(String id, String name, boolean isBodyweight, Equipment equipment,
                              ExerciseCategory category, String defaultUnit, Integer restSeconds,
                              List<CardioMetric> cardioMetrics, List<MuscleContributionDto> muscleContributions,
                              Laterality laterality, Mechanic mechanic, Boolean loadable) {}

    public record CreateExerciseRequest(@NotNull String name, boolean isBodyweight, ExerciseCategory category,
                                        Integer restSeconds, List<CardioMetric> cardioMetrics) {}

    /** Partial update — only non-null fields are applied. */
    public record UpdateExerciseRequest(Equipment equipment, Integer restSeconds, List<CardioMetric> cardioMetrics,
                                        List<MuscleContributionDto> muscleContributions,
                                        Laterality laterality, Mechanic mechanic, Boolean loadable) {}

    // ---- sets / workouts ----  (cardio fields nullable; decimals are STRINGS on the wire)
    public record SetDto(String id, int orderIndex, SetType setType, String weight, LoadMode loadMode,
                         String loadDelta, String weightUnit, Integer reps, Integer rpe, String note,
                         Boolean estimated, SetKind kind, String distanceM, Integer durationS,
                         String gradePct, String elevationGainM, Integer cadenceSpm) {}

    public record ExerciseBlockDto(String exerciseId, String name, int position, String note,
                                   List<SetDto> sets) {}

    public record WorkoutDto(String id, Instant startedAt, Integer durationSeconds, String rawDurationText,
                             String templateId, CyclePhase cyclePhase, List<ExerciseBlockDto> exercises,
                             List<Muscle> soreMuscles, Instant createdAt, Instant updatedAt) {}

    /** Sane decimal pattern: optional sign, 1–4 integer digits, optional 1–3 decimal places (e.g. "100.5", "-20.25"). */
    static final String DECIMAL_PATTERN = "^-?\\d{1,4}(\\.\\d{1,3})?$";

    public record CreateSetRequest(int orderIndex, @NotNull SetType setType,
                                   @Pattern(regexp = DECIMAL_PATTERN, message = "weight must be a decimal ≤ 9999") String weight,
                                   LoadMode loadMode,
                                   @Pattern(regexp = DECIMAL_PATTERN, message = "loadDelta must be a decimal ≤ 9999") String loadDelta,
                                   @Min(0) @Max(1000) Integer reps,
                                   @Min(1) @Max(10) Integer rpe,
                                   String note,
                                   SetKind kind, String distanceM, Integer durationS, String gradePct,
                                   String elevationGainM, Integer cadenceSpm) {}

    public record CreateBlockRequest(@NotNull String exerciseId, String name, int position, String note,
                                     @NotNull @Valid @Size(max = 100) List<CreateSetRequest> sets) {}

    public record CreateWorkoutRequest(@NotNull Instant startedAt, Integer durationSeconds, String templateId,
                                       CyclePhase cyclePhase, @NotNull @Valid @Size(max = 50) List<CreateBlockRequest> exercises,
                                       List<Muscle> soreMuscles) {}

    public record UpdateSetRequest(String weight, @Min(0) @Max(1000) Integer reps, @Min(1) @Max(10) Integer rpe,
                                   String note, SetType setType, String loadDelta) {}

    public record LastWorkingSetDto(String exerciseName, Instant startedAt, int orderIndex, String weight,
                                    LoadMode loadMode, String loadDelta, Integer reps, Integer rpe) {}

    // ---- templates ----
    public record TemplateExerciseDto(String exerciseId, String name, int position, int sets,
                                      Integer reps, String targetRir) {}

    public record TemplateDto(String id, String name, List<TemplateExerciseDto> exercises) {}

    public record TemplateExerciseInput(@NotNull String exerciseId, String name, int position, int sets,
                                        Integer reps, String targetRir) {}

    public record SaveTemplateRequest(@NotNull String name, @NotNull List<TemplateExerciseInput> exercises) {}

    // ---- splits ----
    public record SplitDto(String id, String name, List<String> templateIds, List<Integer> weekdays) {}

    public record SaveSplitRequest(@NotNull String name, List<String> templateIds,
                                   List<@Min(0) @Max(6) Integer> weekdays) {}

    // ---- me / bodyweight ----
    public record BodyweightEntryDto(String id, Instant recordedAt, String weightKg, boolean estimated) {}

    public record ProfileDto(String dateOfBirth, String heightCm, Sex sex, Goal goal,
                             ActivityLevel activityLevel, Integer initialIntakeKcal) {}

    public record MeDto(String id, String email, String currentBodyweightKg,
                        List<BodyweightEntryDto> bodyweightLog, ProfileDto profile) {}

    /** Device-synced UI preferences. `updatedAt` = epoch-millis-as-string; the server keeps the newest
     *  write (last-write-wins). Stored on the User doc; the local-first base lives in the client's SQLite. */
    public record SettingsDto(Map<String, String> settings, String updatedAt) {}

    /** recordedAt: optional ISO date (yyyy-MM-dd) or instant; defaults to now. Lets the user backdate weigh-ins. */
    public record SetBodyweightRequest(
            @NotNull @Pattern(regexp = DECIMAL_PATTERN, message = "weightKg must be a decimal ≤ 9999") String weightKg,
            String recordedAt) {}

    /** Amend an existing weigh-in — only non-null fields are applied. */
    public record UpdateBodyweightEntryRequest(String weightKg, String recordedAt) {}

    /** Partial profile update — only non-null fields are applied. dateOfBirth is ISO yyyy-MM-dd. */
    public record UpdateProfileRequest(String dateOfBirth, String heightCm, Sex sex, Goal goal,
                                       ActivityLevel activityLevel, Integer initialIntakeKcal) {}

    /** Read-time energy-balance estimate (see docs/coach.md). Derived, never stored. NOT medical advice. */
    public record EnergyDto(String status, String phase, String confidence,
                            int weighIns, int spanDays, int minWeighIns, int minSpanDays,
                            String ratePerWeekKg, Integer maintenanceKcalLow, Integer maintenanceKcalHigh,
                            Integer surplusDeficitKcalLow, Integer surplusDeficitKcalHigh,
                            List<String> missingProfile) {}

    // ---- plan (macro/meso/microcycle) ----
    public record IntensityBandDto(int repLow, int repHigh, String targetRir, String pctLow, String pctHigh) {}

    public record MesocycleDto(String name, int accumulationWeeks, String phase, List<Muscle> focusMuscles,
                               BlockType blockType, IntensityBandDto intensityBand) {}

    public record MacrocycleDto(String id, String name, Instant startedAt, String status,
                                int mesoIndex, int week, List<MesocycleDto> mesocycles,
                                String goal, String targetDate, List<Muscle> focusMuscles,
                                String completedAt, String endedAt, String splitId) {}

    public record MesoInput(@NotNull String name, int accumulationWeeks, String phase, List<Muscle> focusMuscles,
                            BlockType blockType, IntensityBandDto intensityBand) {}

    public record CreatePlanRequest(@NotNull String name, @NotNull List<MesoInput> mesocycles,
                                    String goal, String targetDate, List<Muscle> focusMuscles, String splitId) {}
}
