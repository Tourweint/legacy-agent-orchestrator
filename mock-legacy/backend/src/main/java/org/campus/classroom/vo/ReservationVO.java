package org.campus.classroom.vo;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
public class ReservationVO {
    private Long id;
    private String resourceType;
    private Long resourceId;
    private String resourceName;
    private LocalDate reserveDate;
    private LocalDateTime startTime;
    private LocalDateTime endTime;
    private String reason;
    private String status;
    private String attendanceStatus;
    private LocalDateTime checkInTime;
    private Boolean canCheckIn;
    private LocalDateTime createTime;
}
