package org.campus.classroom.entity;

import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
public class Reservation {
    private Long id;
    private Long userId;

    // 当 resourceType=SEAT 时，对应 seat.id
    // 当 resourceType=CLASSROOM 时，对应 classroom.id
    private String resourceType;
    private Long resourceId;

    //冗余字段设计
    private Long classroomId;
    private LocalDate reserveDate;

    //预约时间相关字段
    private LocalDateTime startTime;
    private LocalDateTime endTime;

    private String reason;

    private String status;

    private LocalDateTime createTime;
    private LocalDateTime updateTime;

    public Reservation(Long id, Long userId, String resourceType, Long resourceId, Long classroomId, LocalDateTime startTime, LocalDateTime endTime, String status) {
        this.id = id;
        this.userId = userId;
        this.resourceType = resourceType;
        this.resourceId = resourceId;
        this.classroomId = classroomId;
        this.startTime = startTime;
        this.endTime = endTime;
        this.status = status;
    }
}