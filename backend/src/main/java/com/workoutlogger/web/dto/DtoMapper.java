package com.workoutlogger.web.dto;

import com.workoutlogger.domain.*;
import com.workoutlogger.repo.LastWorkingSetView;
import com.workoutlogger.web.dto.ApiDtos.*;
import org.bson.types.ObjectId;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/** Maps between domain documents and API DTOs, carrying decimals as strings on the wire. */
public final class DtoMapper {

    private DtoMapper() {}

    public static String str(BigDecimal v) { return v == null ? null : v.toPlainString(); }
    public static BigDecimal dec(String v) { return (v == null || v.isBlank()) ? null : new BigDecimal(v.trim()); }

    public static ExerciseDto toDto(Exercise e) {
        var contribs = e.getMuscleContributions() != null
                ? e.getMuscleContributions()
                : com.workoutlogger.importer.MuscleSeed.infer(e.getName());   // inferred when the user hasn't set them
        var contribDtos = contribs.stream()
                .map(c -> new MuscleContributionDto(c.muscle(), str(c.fraction()))).toList();
        return new ExerciseDto(e.getId(), e.getName(), e.isBodyweight(), e.getEquipment(),
                e.getCategory(), e.getDefaultUnit(), e.getRestSeconds(), e.getCardioMetrics(), contribDtos);
    }

    public static SetDto toDto(WorkoutSet s) {
        return new SetDto(s.setId(), s.orderIndex(), s.setType(), str(s.weight()), s.loadMode(),
                str(s.loadDelta()), s.weightUnit(), s.reps(), s.rpe(), s.note(), s.estimated(),
                s.kind(), str(s.distanceM()), s.durationS(), str(s.gradePct()),
                str(s.elevationGainM()), s.cadenceSpm());
    }

    public static ExerciseBlockDto toDto(ExerciseBlock b) {
        return new ExerciseBlockDto(b.exerciseId(), b.name(), b.position(), b.note(),
                b.sets().stream().map(DtoMapper::toDto).toList());
    }

    public static WorkoutDto toDto(Workout w) {
        return new WorkoutDto(w.getId(), w.getStartedAt(), w.getDurationSeconds(), w.getRawDurationText(),
                w.getTemplateId(), w.getExercises().stream().map(DtoMapper::toDto).toList(),
                w.getCreatedAt(), w.getUpdatedAt());
    }

    public static LastWorkingSetDto toDto(LastWorkingSetView v) {
        return new LastWorkingSetDto(v.exerciseName(), v.startedAt(), v.orderIndex(), str(v.weight()),
                v.loadMode() == null ? null : LoadMode.valueOf(v.loadMode()), str(v.loadDelta()),
                v.reps(), v.rpe());
    }

    public static TemplateDto toDto(WorkoutTemplate t) {
        return new TemplateDto(t.getId(), t.getName(), t.getExercises().stream()
                .map(te -> new TemplateExerciseDto(te.exerciseId(), te.name(), te.position(), te.sets())).toList());
    }

    public static List<TemplateExercise> toTemplateExercises(List<ApiDtos.TemplateExerciseInput> in) {
        return in.stream()
                .map(e -> new TemplateExercise(e.exerciseId(), e.name(), e.position(), e.sets()))
                .toList();
    }

    public static MeDto toDto(User u) {
        List<BodyweightEntryDto> log = u.getBodyweightLog().stream()
                .map(e -> new BodyweightEntryDto(e.recordedAt(), str(e.weightKg()), e.estimated())).toList();
        Profile p = u.getProfile();
        ProfileDto profile = p == null ? null : new ProfileDto(
                p.getDateOfBirth() == null ? null : p.getDateOfBirth().toString(),
                str(p.getHeightCm()), p.getSex(), p.getGoal(), p.getActivityLevel(), p.getInitialIntakeKcal());
        return new MeDto(u.getId(), u.getEmail(), str(u.getCurrentBodyweightKg()), log, profile);
    }

    /** Exercise blocks from a request — server mints set ids and loggedAt. Used by create + edit. */
    public static List<ExerciseBlock> toBlocks(CreateWorkoutRequest req) {
        Instant now = Instant.now();
        return req.exercises().stream().map(b -> new ExerciseBlock(
                b.exerciseId(), b.name(), b.position(), b.note(),
                b.sets().stream().map(s -> new WorkoutSet(
                        new ObjectId().toHexString(), s.orderIndex(), s.setType(), dec(s.weight()),
                        s.loadMode(), dec(s.loadDelta()), "kg", s.reps(), s.rpe(), s.note(),
                        now, false, null, null,
                        s.kind() == null ? SetKind.STRENGTH : s.kind(), dec(s.distanceM()), s.durationS(),
                        dec(s.gradePct()), dec(s.elevationGainM()), s.cadenceSpm()
                )).toList()
        )).toList();
    }

    /** Builds a new live-logged session from a create request. */
    public static Workout toWorkout(CreateWorkoutRequest req) {
        Workout w = new Workout();
        w.setId(new ObjectId().toHexString());
        w.setStartedAt(req.startedAt());
        w.setDurationSeconds(req.durationSeconds());
        w.setTemplateId(req.templateId());
        w.setExercises(toBlocks(req));
        return w;
    }

    public static SplitDto toDto(Split s) {
        return new SplitDto(s.getId(), s.getName(), List.copyOf(s.getTemplateIds()));
    }
}
