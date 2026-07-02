package com.workoutlogger.web;

import com.workoutlogger.domain.Workout;
import com.workoutlogger.repo.WorkoutRepository;
import com.workoutlogger.web.dto.ApiDtos.*;
import com.workoutlogger.web.dto.DtoMapper;
import com.workoutlogger.web.error.ApiExceptions;
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

    /**
     * Granular set update addressed by (workoutId, setId). Returns the updated session.
     * Optimistic lock: an optional {@code If-Match} header carries the version the client last read; when
     * present, a stale value → 409 (with the server's current copy in the body), missing/other-tenant/
     * soft-deleted/set-missing → 404. Absent header preserves the legacy unconditioned behavior (single-user
     * clients that don't yet send it). Establishes the If-Match/409 pattern for the wider version audit.
     */
    @PatchMapping("/{workoutId}/sets/{setId}")
    public WorkoutDto updateSet(@PathVariable String workoutId, @PathVariable String setId,
                                @RequestHeader(value = "If-Match", required = false) Long expectedVersion,
                                @Valid @RequestBody UpdateSetRequest req) {
        WorkoutRepository.SetUpdateResult result = workouts.updateSet(workoutId, setId,
                DtoMapper.dec(req.weight()), req.reps(), req.rpe(), req.note(),
                req.setType(), DtoMapper.dec(req.loadDelta()), expectedVersion);
        switch (result) {
            case NOT_FOUND -> throw new NotFoundException("Workout " + workoutId + " / set " + setId + " not found");
            case VERSION_CONFLICT -> {
                WorkoutDto current = workouts.findOne(workoutId).map(DtoMapper::toDto)
                        .orElseThrow(() -> new NotFoundException("Workout " + workoutId + " not found"));
                throw new ApiExceptions.ConflictException("Conflicting concurrent update — please retry.", current);
            }
            case UPDATED -> { /* fall through to return the updated session */ }
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
