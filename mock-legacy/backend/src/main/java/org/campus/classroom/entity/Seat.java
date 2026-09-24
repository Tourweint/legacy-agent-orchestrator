package org.campus.classroom.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class Seat {
    private Long id;
    private Long classroomId;
    private String seatNumber;
    private Integer rowNumber;
    private Integer colNumber;
    private String status;
    private String remark;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}