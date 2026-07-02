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
    public static BigDecimal dec(String v) {
        if (v == null || v.isBlank()) return null;
        try { return new BigDecimal(v.trim()); }
        catch (NumberFormatException e) { throw new com.workoutlogger.web.error.ApiExceptions.BadRequestException("Not a number: " + v); }
    }

    public static ExerciseDto toDto(Exercise e) {
        var contribs = e.getMuscleContributions() != null
                ? e.getMuscleContributions()
                : com.workoutlogger.importer.MuscleSeed.infer(e.getName());   // inferred when the user hasn't set them
        var contribDtos = contribs.stream()
                .map(c -> new MuscleContributionDto(c.muscle(), str(c.fraction()))).toList();
        return new ExerciseDto(e.getId(), e.getName(), e.isBodyweight(), e.getEquipment(),
                e.getCategory(), e.getDefaultUnit(), e.getRestSeconds(), e.getCardioMetrics(), contribDtos,
                e.getLaterality(), e.getMechanic(), e.getLoadable());
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
                w.getTemplateId(), w.getCyclePhase(), w.getExercises().stream().map(DtoMapper::toDto).toList(),
                w.getSoreMuscles(), w.getCreatedAt(), w.getUpdatedAt(), w.getVersion());
    }

    public static ApiDtos.MacrocycleDto toDto(Macrocycle m) {
        var mesos = m.getMesocycles().stream().map(x -> {
            var b = x.intensityBand();
            var band = b == null ? null
                    : new ApiDtos.IntensityBandDto(b.repLow(), b.repHigh(), b.targetRir(), b.pctLow(), b.pctHigh());
            return new ApiDtos.MesocycleDto(x.name(), x.accumulationWeeks(), x.phase(), x.focusMuscles(),
                    x.blockType(), band);
        }).toList();
        return new ApiDtos.MacrocycleDto(m.getId(), m.getName(), m.getStartedAt(), m.getStatus(),
                m.getMesoIndex(), m.getWeek(), mesos, m.getGoal(),
                m.getTargetDate() == null ? null : m.getTargetDate().toString(), m.getFocusMuscles(),
                m.getCompletedAt() == null ? null : m.getCompletedAt().toString(),
                m.getEndedAt() == null ? null : m.getEndedAt().toString(),
                m.getSplitId());
    }

    public static LastWorkingSetDto toDto(LastWorkingSetView v) {
        return new LastWorkingSetDto(v.exerciseName(), v.startedAt(), v.orderIndex(), str(v.weight()),
                v.loadMode() == null ? null : LoadMode.valueOf(v.loadMode()), str(v.loadDelta()),
                v.reps(), v.rpe());
    }

    public static TemplateDto toDto(WorkoutTemplate t) {
        return new TemplateDto(t.getId(), t.getName(), t.getExercises().stream()
                .map(te -> new TemplateExerciseDto(te.exerciseId(), te.name(), te.position(), te.sets(),
                        te.reps(), te.targetRir())).toList());
    }

    public static List<TemplateExercise> toTemplateExercises(List<ApiDtos.TemplateExerciseInput> in) {
        return in.stream()
                .map(e -> new TemplateExercise(e.exerciseId(), e.name(), e.position(), e.sets(),
                        e.reps(), e.targetRir()))
                .toList();
    }

    public static MeDto toDto(User u) {
        List<BodyweightEntryDto> log = u.getBodyweightLog().stream()
                .map(e -> new BodyweightEntryDto(e.entryId(), e.recordedAt(), str(e.weightKg()), e.estimated())).toList();
        Profile p = u.getProfile();
        ProfileDto profile = p == null ? null : new ProfileDto(
                p.getDateOfBirth() == null ? null : p.getDateOfBirth().toString(),
                str(p.getHeightCm()), p.getSex(), p.getGoal(), p.getActivityLevel(), p.getInitialIntakeKcal());
        // Derived at read (M3): the stored mirror is never written anymore; BodyweightMath falls back to
        // it only for legacy import-era docs with no real weigh-in yet.
        return new MeDto(u.getId(), u.getEmail(), str(com.workoutlogger.domain.BodyweightMath.currentOf(u)), log, profile);
    }

    public static ApiDtos.SettingsDto toSettingsDto(User u) {
        return new ApiDtos.SettingsDto(
                u.getSettings() == null ? java.util.Map.of() : u.getSettings(),
                String.valueOf(u.getSettingsUpdatedAt()));
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
        w.setCyclePhase(req.cyclePhase());
        w.setExercises(toBlocks(req));
        w.setSoreMuscles(req.soreMuscles());
        return w;
    }

    public static SplitDto toDto(Split s) {
        return new SplitDto(s.getId(), s.getName(), List.copyOf(s.getTemplateIds()),
                s.getWeekdays() == null ? null : List.copyOf(s.getWeekdays()));
    }
}
