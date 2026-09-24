package org.campus.classroom.dto;

import lombok.Data;

import java.time.LocalDate;

//todo 如果后面要做“我的预约列表”或者管理端筛选
@Data
public class ReservationQueryDTO {
    private Long userId;
    private String resourceType;
    private Long classroomId;
    private LocalDate reserveDate;
    private String status;
}