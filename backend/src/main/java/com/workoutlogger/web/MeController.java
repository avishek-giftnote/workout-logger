package com.workoutlogger.web;

import com.workoutlogger.domain.BodyweightEntry;
import com.workoutlogger.domain.User;
import com.workoutlogger.repo.UserRepository;
import com.workoutlogger.security.Tenant;
import com.workoutlogger.web.dto.ApiDtos.MeDto;
import com.workoutlogger.web.dto.ApiDtos.SetBodyweightRequest;
import com.workoutlogger.web.dto.DtoMapper;
import com.workoutlogger.web.error.ApiExceptions.NotFoundException;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;

@RestController
@RequestMapping("/api/me")
public class MeController {

    private final UserRepository users;
    private final Tenant tenant;

    public MeController(UserRepository users, Tenant tenant) {
        this.users = users;
        this.tenant = tenant;
    }

    private User current() {
        return users.findById(tenant.userId())
                .orElseThrow(() -> new NotFoundException("User not found"));
    }

    @GetMapping
    public MeDto me() {
        return DtoMapper.toDto(current());
    }

    /** Records a new bodyweight measurement; the latest entry is the effective-load baseline. */
    @PutMapping("/bodyweight")
    public MeDto setBodyweight(@Valid @RequestBody SetBodyweightRequest req) {
        User u = current();
        var weight = DtoMapper.dec(req.weightKg());
        u.getBodyweightLog().add(new BodyweightEntry(Instant.now(), weight, false));
        u.setCurrentBodyweightKg(weight);
        u.setUpdatedAt(Instant.now());
        users.save(u);
        return DtoMapper.toDto(u);
    }
}
