package com.workoutlogger.web.dto;

import com.workoutlogger.domain.ActivityLevel;
import com.workoutlogger.domain.CardioMetric;
import com.workoutlogger.domain.Equipment;
import com.workoutlogger.domain.ExerciseCategory;
import com.workoutlogger.domain.Goal;
import com.workoutlogger.domain.LoadMode;
import com.workoutlogger.domain.Muscle;
import com.workoutlogger.domain.Sex;
import com.workoutlogger.domain.SetKind;
import com.workoutlogger.domain.SetType;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.util.List;

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
                              List<CardioMetric> cardioMetrics, List<MuscleContributionDto> muscleContributions) {}

    public record CreateExerciseRequest(@NotNull String name, boolean isBodyweight, ExerciseCategory category,
                                        Integer restSeconds, List<CardioMetric> cardioMetrics) {}

    /** Partial update — only non-null fields are applied. */
    public record UpdateExerciseRequest(Equipment equipment, Integer restSeconds, List<CardioMetric> cardioMetrics,
                                        List<MuscleContributionDto> muscleContributions) {}

    // ---- sets / workouts ----  (cardio fields nullable; decimals are STRINGS on the wire)
    public record SetDto(String id, int orderIndex, SetType setType, String weight, LoadMode loadMode,
                         String loadDelta, String weightUnit, Integer reps, Integer rpe, String note,
                         Boolean estimated, SetKind kind, String distanceM, Integer durationS,
                         String gradePct, String elevationGainM, Integer cadenceSpm) {}

    public record ExerciseBlockDto(String exerciseId, String name, int position, String note,
                                   List<SetDto> sets) {}

    public record WorkoutDto(String id, Instant startedAt, Integer durationSeconds, String rawDurationText,
                             String templateId, List<ExerciseBlockDto> exercises,
                             Instant createdAt, Instant updatedAt) {}

    public record CreateSetRequest(int orderIndex, @NotNull SetType setType, String weight,
                                   LoadMode loadMode, String loadDelta, Integer reps, Integer rpe, String note,
                                   SetKind kind, String distanceM, Integer durationS, String gradePct,
                                   String elevationGainM, Integer cadenceSpm) {}

    public record CreateBlockRequest(@NotNull String exerciseId, String name, int position, String note,
                                     @NotNull List<CreateSetRequest> sets) {}

    public record CreateWorkoutRequest(@NotNull Instant startedAt, Integer durationSeconds, String templateId,
                                       @NotNull List<CreateBlockRequest> exercises) {}

    public record UpdateSetRequest(String weight, Integer reps, Integer rpe, String note,
                                   SetType setType, String loadDelta) {}

    public record LastWorkingSetDto(String exerciseName, Instant startedAt, int orderIndex, String weight,
                                    LoadMode loadMode, String loadDelta, Integer reps, Integer rpe) {}

    // ---- templates ----
    public record TemplateExerciseDto(String exerciseId, String name, int position, int sets) {}

    public record TemplateDto(String id, String name, List<TemplateExerciseDto> exercises) {}

    public record TemplateExerciseInput(@NotNull String exerciseId, String name, int position, int sets) {}

    public record SaveTemplateRequest(@NotNull String name, @NotNull List<TemplateExerciseInput> exercises) {}

    // ---- splits ----
    public record SplitDto(String id, String name, List<String> templateIds) {}

    public record SaveSplitRequest(@NotNull String name, List<String> templateIds) {}

    // ---- me / bodyweight ----
    public record BodyweightEntryDto(Instant recordedAt, String weightKg, boolean estimated) {}

    public record ProfileDto(String dateOfBirth, String heightCm, Sex sex, Goal goal,
                             ActivityLevel activityLevel, Integer initialIntakeKcal) {}

    public record MeDto(String id, String email, String currentBodyweightKg,
                        List<BodyweightEntryDto> bodyweightLog, ProfileDto profile) {}

    public record SetBodyweightRequest(@NotNull String weightKg) {}

    /** Partial profile update — only non-null fields are applied. dateOfBirth is ISO yyyy-MM-dd. */
    public record UpdateProfileRequest(String dateOfBirth, String heightCm, Sex sex, Goal goal,
                                       ActivityLevel activityLevel, Integer initialIntakeKcal) {}
}
