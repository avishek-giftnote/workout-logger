package com.workoutlogger.web;

import com.workoutlogger.repo.SplitRepository;
import com.workoutlogger.web.dto.ApiDtos.SaveSplitRequest;
import com.workoutlogger.web.dto.ApiDtos.SplitDto;
import com.workoutlogger.web.dto.DtoMapper;
import com.workoutlogger.web.error.ApiExceptions.NotFoundException;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/splits")
public class SplitController {

    private final SplitRepository splits;

    public SplitController(SplitRepository splits) {
        this.splits = splits;
    }

    private static List<String> ids(SaveSplitRequest req) {
        return req.templateIds() == null ? List.of() : req.templateIds();
    }

    @GetMapping
    public List<SplitDto> list() {
        return splits.list().stream().map(DtoMapper::toDto).toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SplitDto create(@Valid @RequestBody SaveSplitRequest req) {
        return DtoMapper.toDto(splits.create(req.name(), ids(req), req.weekdays()));
    }

    @PutMapping("/{id}")
    public SplitDto update(@PathVariable String id, @Valid @RequestBody SaveSplitRequest req) {
        return splits.update(id, req.name(), ids(req), req.weekdays()).map(DtoMapper::toDto)
                .orElseThrow(() -> new NotFoundException("Split " + id + " not found"));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id) {
        if (!splits.delete(id)) throw new NotFoundException("Split " + id + " not found");
    }
}
