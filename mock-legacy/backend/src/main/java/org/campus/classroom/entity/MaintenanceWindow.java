package org.campus.classroom.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class MaintenanceWindow {
    private Long id;
    private String resourceType;
    private Long resourceId;
    private Long classroomId;
    private LocalDateTime startTime;
    private LocalDateTime endTime;
    private String reason;
    private String status;
    private Long createBy;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}
