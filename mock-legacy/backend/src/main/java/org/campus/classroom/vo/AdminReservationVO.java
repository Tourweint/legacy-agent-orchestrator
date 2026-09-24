package org.campus.classroom.vo;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
public class AdminReservationVO {
    private Long id;
    private Long userId;
    private String username;
    private String nickname;
    private String resourceType;
    private Long resourceId;
    private String resourceName;
    private LocalDate reserveDate;
    private LocalDateTime startTime;
    private LocalDateTime endTime;
    private String reason;
    private String status;
    private LocalDateTime createTime;
}
