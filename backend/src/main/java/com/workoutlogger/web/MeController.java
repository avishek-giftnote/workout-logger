package com.workoutlogger.web;

import com.workoutlogger.domain.BodyweightEntry;
import com.workoutlogger.domain.Profile;
import com.workoutlogger.domain.User;
import com.workoutlogger.repo.UserRepository;
import com.workoutlogger.security.Tenant;
import com.workoutlogger.web.dto.ApiDtos.MeDto;
import com.workoutlogger.web.dto.ApiDtos.SetBodyweightRequest;
import com.workoutlogger.web.dto.ApiDtos.UpdateProfileRequest;
import com.workoutlogger.web.dto.DtoMapper;
import com.workoutlogger.web.error.ApiExceptions.NotFoundException;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.LocalDate;

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

    /** Partial update of the optional fitness profile (only non-null fields are applied). */
    @PutMapping("/profile")
    public MeDto updateProfile(@Valid @RequestBody UpdateProfileRequest req) {
        User u = current();
        Profile p = u.getProfile() == null ? new Profile() : u.getProfile();
        if (req.dateOfBirth() != null && !req.dateOfBirth().isBlank()) p.setDateOfBirth(LocalDate.parse(req.dateOfBirth().trim()));
        if (req.heightCm() != null) p.setHeightCm(DtoMapper.dec(req.heightCm()));
        if (req.sex() != null) p.setSex(req.sex());
        if (req.goal() != null) p.setGoal(req.goal());
        if (req.activityLevel() != null) p.setActivityLevel(req.activityLevel());
        if (req.initialIntakeKcal() != null) {
            p.setInitialIntakeKcal(req.initialIntakeKcal());
            if (p.getInitialIntakeAt() == null) p.setInitialIntakeAt(Instant.now());
        }
        p.setUpdatedAt(Instant.now());
        u.setProfile(p);
        u.setUpdatedAt(Instant.now());
        users.save(u);
        return DtoMapper.toDto(u);
    }
}
