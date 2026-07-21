package com.workoutlogger.email;

import org.springframework.stereotype.Component;

/**
 * Owns the subject + body copy for each transactional email, so controllers/services never build message
 * strings ad hoc. One place to review the wording (and, later, to swap in HTML templates for a real provider).
 */
@Component
public class EmailTemplates {

    /** Sign-up verification code. The code is short-lived and single-use (see AuthChallenge). */
    public Message signupCode(String code) {
        return new Message("Your Workout Logger verification code",
                "Welcome to Workout Logger.\n\n"
                        + "Your verification code is: " + code + "\n\n"
                        + "Enter it on the sign-up screen to set your password. It expires in a few minutes.\n"
                        + "If you didn't request this, you can ignore this email.");
    }

    public record Message(String subject, String body) {}
}
