package com.workoutlogger.web;

import com.workoutlogger.repo.TemplateRepository;
import com.workoutlogger.web.dto.ApiDtos.SaveTemplateRequest;
import com.workoutlogger.web.dto.ApiDtos.TemplateDto;
import com.workoutlogger.web.dto.DtoMapper;
import com.workoutlogger.web.error.ApiExceptions.NotFoundException;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/templates")
public class TemplateController {

    private final TemplateRepository templates;

    public TemplateController(TemplateRepository templates) {
        this.templates = templates;
    }

    @GetMapping
    public List<TemplateDto> list() {
        return templates.list().stream().map(DtoMapper::toDto).toList();
    }

    @GetMapping("/{id}")
    public TemplateDto get(@PathVariable String id) {
        return templates.findOne(id).map(DtoMapper::toDto)
                .orElseThrow(() -> new NotFoundException("Template " + id + " not found"));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public TemplateDto create(@Valid @RequestBody SaveTemplateRequest req) {
        return DtoMapper.toDto(templates.create(req.name(), DtoMapper.toTemplateExercises(req.exercises())));
    }

    @PutMapping("/{id}")
    public TemplateDto update(@PathVariable String id, @Valid @RequestBody SaveTemplateRequest req) {
        return templates.update(id, req.name(), DtoMapper.toTemplateExercises(req.exercises()))
                .map(DtoMapper::toDto)
                .orElseThrow(() -> new NotFoundException("Template " + id + " not found"));
    }
}
