package org.campus.classroom.vo;

import lombok.Data;

@Data
public class AdminClassroomUtilizationVO {
    private Long classroomId;
    private String building;
    private String roomNumber;
    private String status;
    private Integer capacity;
    private Long reservationCount;
    private Long reservedMinutes;
    private Double utilizationRate;
}
