package org.campus.classroom.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class ViolationRecord {
    private Long id;
    private Long userId;
    private Long reservationId;
    private String type;
    private String remark;
    private LocalDateTime createTime;
}
