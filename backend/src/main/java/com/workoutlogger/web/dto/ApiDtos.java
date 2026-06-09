package com.workoutlogger.web.dto;

import com.workoutlogger.domain.LoadMode;
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
    public record ExerciseDto(String id, String name, boolean isBodyweight, String defaultUnit) {}

    public record CreateExerciseRequest(@NotNull String name, boolean isBodyweight) {}

    // ---- sets / workouts ----
    public record SetDto(String id, int orderIndex, SetType setType, String weight, LoadMode loadMode,
                         String loadDelta, String weightUnit, Integer reps, Integer rpe, String note,
                         Boolean estimated) {}

    public record ExerciseBlockDto(String exerciseId, String name, int position, String note,
                                   List<SetDto> sets) {}

    public record WorkoutDto(String id, Instant startedAt, Integer durationSeconds, String rawDurationText,
                             String templateId, List<ExerciseBlockDto> exercises,
                             Instant createdAt, Instant updatedAt) {}

    public record CreateSetRequest(int orderIndex, @NotNull SetType setType, String weight,
                                   LoadMode loadMode, String loadDelta, Integer reps, Integer rpe, String note) {}

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

    // ---- me / bodyweight ----
    public record BodyweightEntryDto(Instant recordedAt, String weightKg, boolean estimated) {}

    public record MeDto(String id, String email, String currentBodyweightKg, List<BodyweightEntryDto> bodyweightLog) {}

    public record SetBodyweightRequest(@NotNull String weightKg) {}
}
