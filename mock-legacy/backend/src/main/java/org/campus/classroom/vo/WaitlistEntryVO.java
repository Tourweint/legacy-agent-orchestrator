package org.campus.classroom.vo;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class WaitlistEntryVO {
    private Long id;
    private Long seatId;
    private Long classroomId;
    private String resourceName;
    private LocalDateTime startTime;
    private LocalDateTime endTime;
    private String reason;
    private String status;
    private Long promotedReservationId;
    private LocalDateTime createTime;
}
