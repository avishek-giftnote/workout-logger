package com.workoutlogger.web;

import com.workoutlogger.importer.DefaultExerciseSeeder;
import com.workoutlogger.repo.ExerciseRepository;
import com.workoutlogger.repo.WorkoutRepository;
import com.workoutlogger.security.Tenant;
import com.workoutlogger.web.dto.ApiDtos.*;
import com.workoutlogger.web.dto.DtoMapper;
import com.workoutlogger.web.error.ApiExceptions.NotFoundException;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/exercises")
public class ExerciseController {

    private final ExerciseRepository exercises;
    private final WorkoutRepository workouts;
    private final DefaultExerciseSeeder seeder;
    private final Tenant tenant;

    public ExerciseController(ExerciseRepository exercises, WorkoutRepository workouts,
                              DefaultExerciseSeeder seeder, Tenant tenant) {
        this.exercises = exercises;
        this.workouts = workouts;
        this.seeder = seeder;
        this.tenant = tenant;
    }

    /** Adds any default catalog exercises this user is missing (idempotent). Returns {added: n}. */
    @PostMapping("/restore-defaults")
    public Map<String, Integer> restoreDefaults() {
        return Map.of("added", seeder.seedMissing(tenant.userId()));
    }

    @GetMapping
    public List<ExerciseDto> list() {
        return exercises.list().stream().map(DtoMapper::toDto).toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ExerciseDto create(@Valid @RequestBody CreateExerciseRequest req) {
        return DtoMapper.toDto(exercises.create(req.name(), req.isBodyweight(), req.category(),
                req.restSeconds(), req.cardioMetrics()));
    }

    /** Partial update: equipment, rest, cardio metrics, muscle map, laterality, mechanic, loadability. */
    @PatchMapping("/{id}")
    public ExerciseDto update(@PathVariable String id, @Valid @RequestBody UpdateExerciseRequest req) {
        var muscles = req.muscleContributions() == null ? null : req.muscleContributions().stream()
                .map(d -> new com.workoutlogger.domain.MuscleContribution(d.muscle(), DtoMapper.dec(d.fraction()))).toList();
        return exercises.update(id, req.equipment(), req.restSeconds(), req.cardioMetrics(), muscles,
                        req.laterality(), req.mechanic(), req.loadable()).map(DtoMapper::toDto)
                .orElseThrow(() -> new NotFoundException("Exercise " + id + " not found"));
    }

    @GetMapping("/{id}/last-working-set")
    public LastWorkingSetDto lastWorkingSet(@PathVariable String id) {
        return workouts.lastWorkingSet(id).map(DtoMapper::toDto)
                .orElseThrow(() -> new NotFoundException("No working set found for exercise " + id));
    }
}
