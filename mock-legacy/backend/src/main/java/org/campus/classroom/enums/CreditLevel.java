package org.campus.classroom.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@RequiredArgsConstructor
@Getter
public enum CreditLevel {
    A("A", 80, 24),
    B("B", 50, 12),
    C("C", 30, 6);

    private final String code;
    private final int minScore;
    private final int seatReservationAdvanceHours;

    public static int normalizeScore(Integer score) {
        if (score == null) {
            return 100;
        }
        return Math.max(30, Math.min(100, score));
    }

    public static CreditLevel fromScore(Integer score) {
        int normalizedScore = normalizeScore(score);
        if (normalizedScore >= A.minScore) {
            return A;
        }
        if (normalizedScore >= B.minScore) {
            return B;
        }
        return C;
    }
}
