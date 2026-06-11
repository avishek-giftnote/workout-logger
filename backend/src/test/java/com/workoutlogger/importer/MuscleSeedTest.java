package com.workoutlogger.importer;

import com.workoutlogger.domain.Muscle;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class MuscleSeedTest {

    private List<Muscle> muscles(String name) {
        return MuscleSeed.infer(name).stream().map(c -> c.muscle()).toList();
    }

    @Test
    void compoundsCreditPrimaryAndSecondaryMuscles() {
        assertThat(muscles("Incline Bench Press (Dumbbell)"))
                .containsExactlyInAnyOrder(Muscle.CHEST, Muscle.FRONT_DELT, Muscle.TRICEP);
        assertThat(muscles("Seated Overhead Press (Dumbbell)"))
                .containsExactlyInAnyOrder(Muscle.FRONT_DELT, Muscle.SIDE_DELT, Muscle.TRICEP);
    }

    @Test
    void primaryIsOnePointZero_secondaryIsLess() {
        var bench = MuscleSeed.infer("Bench Press");
        assertThat(bench).anySatisfy(c -> {
            assertThat(c.muscle()).isEqualTo(Muscle.CHEST);
            assertThat(c.fraction()).isEqualByComparingTo("1.0");
        });
        assertThat(bench).anySatisfy(c -> {
            assertThat(c.muscle()).isEqualTo(Muscle.TRICEP);
            assertThat(c.fraction()).isLessThan(java.math.BigDecimal.ONE);
        });
    }

    @Test
    void crunchIsAbs_notCardio() {   // regression: "crunch" once matched the cardio keyword "run"
        assertThat(muscles("Cable Crunch")).containsExactly(Muscle.ABS);
        assertThat(muscles("Machine crunches")).containsExactly(Muscle.ABS);
    }

    @Test
    void cardioReturnsEmpty() {
        assertThat(MuscleSeed.infer("Treadmill Run")).isEmpty();
        assertThat(MuscleSeed.infer("Pool Swim")).isEmpty();
        assertThat(MuscleSeed.infer("Cycle")).isEmpty();
    }

    @Test
    void curlVariantsDisambiguate() {
        assertThat(muscles("Seated Leg Curl (Machine)")).containsExactly(Muscle.HAMSTRING);
        assertThat(muscles("Cable Wrist Curl")).containsExactly(Muscle.FOREARM);
        assertThat(muscles("Hammer Curl (Cable)")).contains(Muscle.BICEP);
    }

    @Test
    void rowsAndPulldownsAreLatPrimary() {
        assertThat(muscles("Seated Row (Cable)")).contains(Muscle.LAT);
        assertThat(muscles("Lat Pulldown MAG Grip")).contains(Muscle.LAT);
    }

    @Test
    void cardioMachinesAreNotMisCreditedAsStrength() {
        assertThat(MuscleSeed.infer("Rowing Machine")).isEmpty();   // "rowing" guards the "row" → lat rule
        assertThat(MuscleSeed.infer("Stair Climber")).isEmpty();
        assertThat(muscles("Barbell Row")).contains(Muscle.LAT);    // a real row still maps
    }

    @Test
    void unrecognizedReturnsEmpty(/* flagged "unmapped" in the UI */) {
        assertThat(MuscleSeed.infer("Hip Adductor (Machine)")).isEmpty();
        assertThat(MuscleSeed.infer("Some Made Up Lift")).isEmpty();
        assertThat(MuscleSeed.infer(null)).isEmpty();
    }
}
