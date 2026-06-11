package com.workoutlogger.web;

import com.workoutlogger.domain.Workout;
import com.workoutlogger.repo.WorkoutRepository;
import com.workoutlogger.web.dto.ApiDtos.*;
import com.workoutlogger.web.dto.DtoMapper;
import com.workoutlogger.web.error.ApiExceptions.NotFoundException;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/workouts")
public class WorkoutController {

    private final WorkoutRepository workouts;

    public WorkoutController(WorkoutRepository workouts) {
        this.workouts = workouts;
    }

    @GetMapping
    public List<WorkoutDto> list() {
        return workouts.list().stream().map(DtoMapper::toDto).toList();
    }

    @GetMapping("/{id}")
    public WorkoutDto get(@PathVariable String id) {
        return workouts.findOne(id).map(DtoMapper::toDto)
                .orElseThrow(() -> new NotFoundException("Workout " + id + " not found"));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public WorkoutDto create(@Valid @RequestBody CreateWorkoutRequest req) {
        Workout saved = workouts.insert(DtoMapper.toWorkout(req));
        return DtoMapper.toDto(saved);
    }

    /** Full edit of a completed session: replace its exercises/sets, deload flag, and soreness report. */
    @PutMapping("/{id}")
    public WorkoutDto update(@PathVariable String id, @Valid @RequestBody CreateWorkoutRequest req) {
        return workouts.replaceExercises(id, DtoMapper.toBlocks(req), req.templateId(), req.cyclePhase(), req.soreMuscles())
                .map(DtoMapper::toDto)
                .orElseThrow(() -> new NotFoundException("Workout " + id + " not found"));
    }

    /** Granular set update addressed by (workoutId, setId). Returns the updated session. */
    @PatchMapping("/{workoutId}/sets/{setId}")
    public WorkoutDto updateSet(@PathVariable String workoutId, @PathVariable String setId,
                                @Valid @RequestBody UpdateSetRequest req) {
        boolean updated = workouts.updateSet(workoutId, setId,
                DtoMapper.dec(req.weight()), req.reps(), req.rpe(), req.note(),
                req.setType(), DtoMapper.dec(req.loadDelta()));
        if (!updated) {
            throw new NotFoundException("Workout " + workoutId + " / set " + setId + " not found");
        }
        return workouts.findOne(workoutId).map(DtoMapper::toDto)
                .orElseThrow(() -> new NotFoundException("Workout " + workoutId + " not found"));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id) {
        if (!workouts.softDelete(id)) {
            throw new NotFoundException("Workout " + id + " not found");
        }
    }
}
