package com.workoutlogger.web;

import com.workoutlogger.repo.ExerciseRepository;
import com.workoutlogger.repo.WorkoutRepository;
import com.workoutlogger.web.dto.ApiDtos.*;
import com.workoutlogger.web.dto.DtoMapper;
import com.workoutlogger.web.error.ApiExceptions.NotFoundException;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/exercises")
public class ExerciseController {

    private final ExerciseRepository exercises;
    private final WorkoutRepository workouts;

    public ExerciseController(ExerciseRepository exercises, WorkoutRepository workouts) {
        this.exercises = exercises;
        this.workouts = workouts;
    }

    @GetMapping
    public List<ExerciseDto> list() {
        return exercises.list().stream().map(DtoMapper::toDto).toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ExerciseDto create(@Valid @RequestBody CreateExerciseRequest req) {
        return DtoMapper.toDto(exercises.create(req.name(), req.isBodyweight()));
    }

    @GetMapping("/{id}/last-working-set")
    public LastWorkingSetDto lastWorkingSet(@PathVariable String id) {
        return workouts.lastWorkingSet(id).map(DtoMapper::toDto)
                .orElseThrow(() -> new NotFoundException("No working set found for exercise " + id));
    }
}
