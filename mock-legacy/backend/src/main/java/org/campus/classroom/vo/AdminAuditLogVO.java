package org.campus.classroom.vo;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class AdminAuditLogVO {
    private Long id;
    private Long adminUserId;
    private String adminUsername;
    private String actionType;
    private String targetType;
    private Long targetId;
    private String targetName;
    private String detail;
    private String ip;
    private LocalDateTime createTime;
}
