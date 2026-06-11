package com.workoutlogger.web;

import com.workoutlogger.coach.EnergyService;
import com.workoutlogger.domain.BodyweightEntry;
import com.workoutlogger.domain.Profile;
import com.workoutlogger.domain.User;
import com.workoutlogger.repo.UserRepository;
import com.workoutlogger.security.Tenant;
import com.workoutlogger.web.dto.ApiDtos.EnergyDto;
import com.workoutlogger.web.dto.ApiDtos.MeDto;
import com.workoutlogger.web.dto.ApiDtos.SetBodyweightRequest;
import com.workoutlogger.web.dto.ApiDtos.UpdateBodyweightEntryRequest;
import com.workoutlogger.web.dto.ApiDtos.UpdateProfileRequest;
import com.workoutlogger.web.dto.DtoMapper;
import com.workoutlogger.web.error.ApiExceptions.NotFoundException;
import jakarta.validation.Valid;
import org.bson.types.ObjectId;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.List;

@RestController
@RequestMapping("/api/me")
public class MeController {

    private final UserRepository users;
    private final Tenant tenant;
    private final EnergyService energy;

    public MeController(UserRepository users, Tenant tenant, EnergyService energy) {
        this.users = users;
        this.tenant = tenant;
        this.energy = energy;
    }

    /** Read-time energy-balance estimate (derived; never stored). */
    @GetMapping("/energy")
    public EnergyDto energy() {
        return energy.estimate(current());
    }

    private User current() {
        User u = users.findById(tenant.userId())
                .orElseThrow(() -> new NotFoundException("User not found"));
        if (backfillIds(u)) users.save(u);   // give legacy weigh-ins stable ids so they can be amended/deleted
        return u;
    }

    private static boolean backfillIds(User u) {
        List<BodyweightEntry> log = u.getBodyweightLog();
        boolean changed = false;
        for (int i = 0; i < log.size(); i++) {
            BodyweightEntry e = log.get(i);
            if (e.id() == null) {
                log.set(i, new BodyweightEntry(new ObjectId().toHexString(), e.recordedAt(), e.weightKg(), e.estimated()));
                changed = true;
            }
        }
        return changed;
    }

    /** currentBodyweightKg = latest REAL weigh-in, else null — never an estimated import value (it would
     *  poison the calisthenics effective-load calc). */
    private static void recomputeCurrent(User u) {
        u.setCurrentBodyweightKg(u.getBodyweightLog().stream()
                .filter(e -> !e.estimated())
                .max(Comparator.comparing(BodyweightEntry::recordedAt))
                .map(BodyweightEntry::weightKg).orElse(null));
    }

    @GetMapping
    public MeDto me() {
        return DtoMapper.toDto(current());
    }

    /** Records a bodyweight measurement (optionally backdated). currentBodyweightKg tracks the LATEST entry. */
    @PutMapping("/bodyweight")
    public MeDto setBodyweight(@Valid @RequestBody SetBodyweightRequest req) {
        User u = current();
        u.getBodyweightLog().add(new BodyweightEntry(new ObjectId().toHexString(),
                parseWhen(req.recordedAt()), DtoMapper.dec(req.weightKg()), false));
        recomputeCurrent(u);
        u.setUpdatedAt(Instant.now());
        users.save(u);
        return DtoMapper.toDto(u);
    }

    /** Amends a weigh-in (weight and/or date). */
    @PatchMapping("/bodyweight/{id}")
    public MeDto amendBodyweight(@PathVariable String id, @RequestBody UpdateBodyweightEntryRequest req) {
        User u = current();
        var log = u.getBodyweightLog();
        int i = indexOf(log, id);
        if (i < 0) throw new NotFoundException("Weigh-in " + id + " not found");
        BodyweightEntry e = log.get(i);
        var weight = (req.weightKg() == null || req.weightKg().isBlank()) ? e.weightKg() : DtoMapper.dec(req.weightKg());
        var when = (req.recordedAt() == null || req.recordedAt().isBlank()) ? e.recordedAt() : parseWhen(req.recordedAt());
        log.set(i, new BodyweightEntry(e.id(), when, weight, false));   // an amended entry is a real measurement
        recomputeCurrent(u);
        u.setUpdatedAt(Instant.now());
        users.save(u);
        return DtoMapper.toDto(u);
    }

    /** Deletes a weigh-in. */
    @DeleteMapping("/bodyweight/{id}")
    public MeDto deleteBodyweight(@PathVariable String id) {
        User u = current();
        var log = u.getBodyweightLog();
        int i = indexOf(log, id);
        if (i < 0) throw new NotFoundException("Weigh-in " + id + " not found");
        log.remove(i);
        recomputeCurrent(u);
        u.setUpdatedAt(Instant.now());
        users.save(u);
        return DtoMapper.toDto(u);
    }

    private static int indexOf(List<BodyweightEntry> log, String id) {
        for (int i = 0; i < log.size(); i++) if (id.equals(log.get(i).id())) return i;
        return -1;
    }

    /** Blank → now; a yyyy-MM-dd date → that day at 12:00 UTC; otherwise a parsed instant. */
    private static Instant parseWhen(String s) {
        if (s == null || s.isBlank()) return Instant.now();
        try { return Instant.parse(s.trim()); }
        catch (Exception ignored) {
            return LocalDate.parse(s.trim()).atTime(12, 0).toInstant(ZoneOffset.UTC);
        }
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
