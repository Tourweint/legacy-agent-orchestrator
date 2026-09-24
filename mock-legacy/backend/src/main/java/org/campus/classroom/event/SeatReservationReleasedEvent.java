package org.campus.classroom.event;

import java.time.LocalDateTime;

public record SeatReservationReleasedEvent(
        Long seatId,
        LocalDateTime startTime,
        LocalDateTime endTime
) {
}
