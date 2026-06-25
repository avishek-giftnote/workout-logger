package com.workoutlogger.web;

import com.workoutlogger.domain.IntensityBand;
import com.workoutlogger.domain.Mesocycle;
import com.workoutlogger.repo.PlanRepository;
import com.workoutlogger.web.dto.ApiDtos.CreatePlanRequest;
import com.workoutlogger.web.dto.ApiDtos.MacrocycleDto;
import com.workoutlogger.web.dto.ApiDtos.MesoInput;
import com.workoutlogger.web.dto.DtoMapper;
import com.workoutlogger.web.error.ApiExceptions.BadRequestException;
import com.workoutlogger.web.error.ApiExceptions.NotFoundException;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping("/api/plan")
public class PlanController {

    private final PlanRepository plans;

    public PlanController(PlanRepository plans) {
        this.plans = plans;
    }

    private static Mesocycle meso(MesoInput mi) {
        var b = mi.intensityBand();
        var band = b == null ? null : new IntensityBand(b.repLow(), b.repHigh(), b.targetRir(), b.pctLow(), b.pctHigh());
        if (band != null) {
            if (band.repLow() <= 0 || band.repHigh() <= 0 || band.repLow() > band.repHigh())
                throw new BadRequestException("intensityBand: reps must be positive and repLow ≤ repHigh");
            for (String p : new String[]{band.pctLow(), band.pctHigh()}) {
                if (p == null || p.isBlank()) continue;
                try {
                    var d = new java.math.BigDecimal(p);
                    if (d.signum() <= 0 || d.compareTo(new java.math.BigDecimal("1.5")) > 0)
                        throw new BadRequestException("intensityBand: %1RM must be in (0, 1.5]");
                } catch (NumberFormatException e) { throw new BadRequestException("intensityBand: %1RM not a number"); }
            }
            // pctLow ≤ pctHigh, and targetRir must be a number or a range like "1-2" (not a free string). (council SM5)
            if (band.pctLow() != null && !band.pctLow().isBlank() && band.pctHigh() != null && !band.pctHigh().isBlank()
                    && new java.math.BigDecimal(band.pctLow()).compareTo(new java.math.BigDecimal(band.pctHigh())) > 0)
                throw new BadRequestException("intensityBand: %1RM low must be ≤ high");
            if (band.targetRir() != null && !band.targetRir().isBlank() && !band.targetRir().trim().matches("\\d+(\\s*-\\s*\\d+)?"))
                throw new BadRequestException("intensityBand: targetRir must be a number or a range like \"1-2\"");
        }
        return new Mesocycle(mi.name(), Math.max(1, mi.accumulationWeeks()), mi.phase(), mi.focusMuscles(),
                mi.blockType(), band);
    }
    private static LocalDate date(String s) {
        return (s == null || s.isBlank()) ? null : LocalDate.parse(s.trim());
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
        return DtoMapper.toDto(plans.create(req.name(), req.mesocycles().stream().map(PlanController::meso).toList(),
                req.goal(), date(req.targetDate()), req.focusMuscles()));
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

    /** All COMPLETED and ENDED plans for the authenticated user, newest-first. */
    @GetMapping("/history")
    public List<MacrocycleDto> history() {
        return plans.findTerminal().stream().map(DtoMapper::toDto).toList();
    }
}
