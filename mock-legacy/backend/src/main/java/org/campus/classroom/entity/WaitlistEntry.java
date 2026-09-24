package org.campus.classroom.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class WaitlistEntry {
    private Long id;
    private Long userId;
    private Long seatId;
    private Long classroomId;
    private LocalDateTime startTime;
    private LocalDateTime endTime;
    private String reason;
    private String status;
    private Long promotedReservationId;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}
