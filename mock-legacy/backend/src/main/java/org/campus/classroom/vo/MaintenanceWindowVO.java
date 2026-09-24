package org.campus.classroom.vo;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class MaintenanceWindowVO {
    private Long id;
    private String resourceType;
    private Long resourceId;
    private Long classroomId;
    private String resourceName;
    private LocalDateTime startTime;
    private LocalDateTime endTime;
    private String reason;
    private String status;
    private Long createBy;
    private String createByUsername;
    private LocalDateTime createTime;
}
