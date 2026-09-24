package org.campus.classroom.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class AttendanceRecord {
    private Long id;
    private Long reservationId;
    private String status;
    private LocalDateTime checkInTime;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}
