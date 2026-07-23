package com.workoutlogger.web;

import com.workoutlogger.coach.EnergyService;
import com.workoutlogger.domain.BodyweightEntry;
import com.workoutlogger.domain.User;
import com.workoutlogger.repo.MeRepository;
import com.workoutlogger.repo.WorkoutRepository;
import com.workoutlogger.web.auth.AccountWipeService;
import com.workoutlogger.web.dto.ApiDtos.DeleteAccountRequest;
import com.workoutlogger.web.dto.ApiDtos.EnergyDto;
import com.workoutlogger.web.dto.ApiDtos.MeDto;
import com.workoutlogger.web.dto.ApiDtos.SettingsDto;
import com.workoutlogger.web.dto.ApiDtos.SetBodyweightRequest;
import com.workoutlogger.web.dto.ApiDtos.UpdateBodyweightEntryRequest;
import com.workoutlogger.web.dto.ApiDtos.UpdateProfileRequest;
import com.workoutlogger.web.dto.DtoMapper;
import com.workoutlogger.web.error.ApiExceptions.BadRequestException;
import com.workoutlogger.web.error.ApiExceptions.NotFoundException;
import jakarta.validation.Valid;
import org.bson.types.ObjectId;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The current user's own document. Every mutation here is a TARGETED ATOMIC update via
 * {@link MeRepository} — never a read-modify-write {@code save()} of the whole User doc, which lost
 * concurrent writes (audit M3; mechanism-selection rule in DESIGN.md §2a). Reads never write.
 */
@RestController
@RequestMapping("/api/me")
public class MeController {

    private final MeRepository me;
    private final EnergyService energy;
    private final WorkoutRepository workouts;
    private final AccountWipeService wipe;
    private final PasswordEncoder encoder;

    public MeController(MeRepository me, EnergyService energy, WorkoutRepository workouts,
                        AccountWipeService wipe, PasswordEncoder encoder) {
        this.me = me;
        this.energy = energy;
        this.workouts = workouts;
        this.wipe = wipe;
        this.encoder = encoder;
    }

    /** Read-time energy-balance estimate (derived; never stored). The trailing-7-day session count feeds the
     *  display-only workout-energy term — resolved here (tenant-scoped) and passed as a plain int so
     *  {@link EnergyService} stays a pure, repository-free function. */
    @GetMapping("/energy")
    public EnergyDto energy() {
        int recentSessions = (int) workouts.countSince(Instant.now().minus(java.time.Duration.ofDays(7)));
        return energy.estimate(current(), recentSessions);
    }

    /** The user's synced UI preferences (the local-first base lives in the client's SQLite). */
    @GetMapping("/settings")
    public SettingsDto getSettings() {
        return DtoMapper.toSettingsDto(current());
    }

    /**
     * Upserts settings with last-write-wins by epoch-millis `updatedAt`, enforced ATOMICALLY — the
     * newest-wins check is inside the update's match, not a read-then-save. Always 200, never 409 (the
     * client fire-and-forgets this path): a winning write echoes the committed values; a superseded one
     * returns the persisted winner so the caller can reconcile.
     */
    @PutMapping("/settings")
    public SettingsDto putSettings(@RequestBody SettingsDto req) {
        long incoming = parseTs(req.updatedAt());
        Map<String, String> settings = req.settings() == null
                ? new java.util.HashMap<>() : new java.util.HashMap<>(req.settings());
        if (me.putSettingsIfNewer(settings, incoming)) {
            return new SettingsDto(settings, String.valueOf(incoming));   // we won: Mongo committed exactly this
        }
        return DtoMapper.toSettingsDto(current());   // superseded (or racing): return the persisted winner
    }

    private static long parseTs(String s) {
        try { return (s == null || s.isBlank()) ? 0L : Long.parseLong(s.trim()); }
        catch (NumberFormatException e) { return 0L; }
    }

    /** Pure read — the legacy id-backfill save() moved to {@code BodyweightEntryIdBackfillRunner}. */
    private User current() {
        return me.find().orElseThrow(() -> new NotFoundException("User not found"));
    }

    @GetMapping
    public MeDto me() {
        return DtoMapper.toDto(current());
    }

    /** Records a bodyweight measurement (optionally backdated). The log cap is enforced inside the
     *  atomic append's match, so concurrent adds can't overshoot it. */
    @PutMapping("/bodyweight")
    public MeDto setBodyweight(@Valid @RequestBody SetBodyweightRequest req) {
        BodyweightEntry entry = new BodyweightEntry(new ObjectId().toHexString(),
                parseWhen(req.recordedAt()), DtoMapper.dec(req.weightKg()), false);
        switch (me.addBodyweight(entry)) {
            case CAP_FULL -> throw new BadRequestException("Bodyweight log is full");
            case NOT_FOUND -> throw new NotFoundException("User not found");
            case ADDED -> { /* fall through */ }
        }
        return DtoMapper.toDto(current());
    }

    /** Amends a weigh-in (weight and/or date) — one positional atomic $set keyed by entry id. */
    @PatchMapping("/bodyweight/{id}")
    public MeDto amendBodyweight(@PathVariable String id, @RequestBody UpdateBodyweightEntryRequest req) {
        var weight = (req.weightKg() == null || req.weightKg().isBlank()) ? null : DtoMapper.dec(req.weightKg());
        var when = (req.recordedAt() == null || req.recordedAt().isBlank()) ? null : parseWhen(req.recordedAt());
        if (!me.amendBodyweight(id, weight, when)) {
            throw new NotFoundException("Weigh-in " + id + " not found");
        }
        return DtoMapper.toDto(current());
    }

    /** Deletes a weigh-in — one atomic $pull keyed by entry id. */
    @DeleteMapping("/bodyweight/{id}")
    public MeDto deleteBodyweight(@PathVariable String id) {
        if (!me.deleteBodyweight(id)) {
            throw new NotFoundException("Weigh-in " + id + " not found");
        }
        return DtoMapper.toDto(current());
    }

    /** Blank → now; a yyyy-MM-dd date → that day at 12:00 UTC; otherwise a parsed instant. */
    private static Instant parseWhen(String s) {
        if (s == null || s.isBlank()) return Instant.now();
        try { return Instant.parse(s.trim()); }
        catch (Exception ignored) {
            try { return LocalDate.parse(s.trim()).atTime(12, 0).toInstant(ZoneOffset.UTC); }
            catch (RuntimeException e) { throw new BadRequestException("Invalid date: " + s); }
        }
    }

    /** Partial update of the optional fitness profile — per-field atomic $set (only non-null fields),
     *  so concurrent edits to different fields both land. initialIntakeAt stays set-once. */
    @PutMapping("/profile")
    public MeDto updateProfile(@Valid @RequestBody UpdateProfileRequest req) {
        Map<String, Object> fields = new LinkedHashMap<>();
        if (req.dateOfBirth() != null && !req.dateOfBirth().isBlank()) {
            try { fields.put("dateOfBirth", LocalDate.parse(req.dateOfBirth().trim())); }
            catch (RuntimeException e) { throw new BadRequestException("Invalid date: " + req.dateOfBirth()); }
        }
        if (req.heightCm() != null) fields.put("heightCm", DtoMapper.dec(req.heightCm()));
        if (req.sex() != null) fields.put("sex", req.sex());
        if (req.goal() != null) fields.put("goal", req.goal());
        if (req.activityLevel() != null) fields.put("activityLevel", req.activityLevel());
        boolean firstIntake = req.initialIntakeKcal() != null;
        if (firstIntake) fields.put("initialIntakeKcal", req.initialIntakeKcal());
        if (!me.updateProfileFields(fields, firstIntake)) {
            throw new NotFoundException("User not found");
        }
        return DtoMapper.toDto(current());
    }

    /**
     * "Confirm Account Wipe": permanently delete the account and ALL its data. The REAL guard is a server-side
     * BCrypt re-verification of the current password (a stolen/leftover bearer token must not be able to nuke
     * everything on its own); the typed confirmation phrase is UI-friction, not checked here. Wrong password ⇒
     * 403 and NOTHING is deleted. On success the cascade runs (children first, the User doc last — see
     * {@link AccountWipeService}) and returns 204; the next request with the now-dead token 401s (the User doc
     * is gone), which the client turns into a sign-out. Rate-limited (RateLimitConfig) so it can't be used as a
     * password-guessing oracle.
     */
    @PostMapping("/delete")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteAccount(@Valid @RequestBody DeleteAccountRequest req) {
        User u = current();
        if (u.getPasswordHash() == null || !encoder.matches(req.password(), u.getPasswordHash())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Incorrect password");
        }
        wipe.wipeCurrentTenant();
    }
}
