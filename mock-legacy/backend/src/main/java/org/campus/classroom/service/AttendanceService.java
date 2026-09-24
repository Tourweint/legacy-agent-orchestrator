package org.campus.classroom.service;

public interface AttendanceService {
    Boolean checkIn(Long currentUserId, Long reservationId);

    int markNoShows();

    void markCancelledIfPending(Long reservationId);

    int recoverCreditScoreDaily();
}
