package com.workoutlogger.web;

import com.workoutlogger.domain.Mesocycle;
import com.workoutlogger.repo.PlanRepository;
import com.workoutlogger.web.dto.ApiDtos.CreatePlanRequest;
import com.workoutlogger.web.dto.ApiDtos.MacrocycleDto;
import com.workoutlogger.web.dto.ApiDtos.MesoInput;
import com.workoutlogger.web.dto.DtoMapper;
import com.workoutlogger.web.error.ApiExceptions.NotFoundException;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/plan")
public class PlanController {

    private final PlanRepository plans;

    public PlanController(PlanRepository plans) {
        this.plans = plans;
    }

    private static Mesocycle meso(MesoInput mi) {
        return new Mesocycle(mi.name(), Math.max(1, mi.accumulationWeeks()), mi.phase(), mi.focusMuscles());
    }

    /** The active macrocycle, or 204 if the user has no plan. */
    @GetMapping
    public ResponseEntity<MacrocycleDto> get() {
        return plans.findActive().map(DtoMapper::toDto).map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    /** Starts a new plan (replacing any active one). */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public MacrocycleDto create(@Valid @RequestBody CreatePlanRequest req) {
        return DtoMapper.toDto(plans.create(req.name(), req.mesocycles().stream().map(PlanController::meso).toList()));
    }

    /** Advances one microcycle (week → deload → next mesocycle → completed). */
    @PostMapping("/advance")
    public MacrocycleDto advance() {
        return plans.advance().map(DtoMapper::toDto)
                .orElseThrow(() -> new NotFoundException("No active plan"));
    }

    /** Appends a mesocycle to the active macrocycle. */
    @PostMapping("/mesocycle")
    public MacrocycleDto addMesocycle(@Valid @RequestBody MesoInput mi) {
        return plans.addMesocycle(meso(mi)).map(DtoMapper::toDto)
                .orElseThrow(() -> new NotFoundException("No active plan"));
    }

    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void end() {
        plans.endActive();
    }
}
