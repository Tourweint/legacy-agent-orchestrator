package org.campus.classroom.vo;

import lombok.Data;

@Data
public class AdminBuildingHeatVO {
    private String building;
    private Long reservationCount;
    private Long reservedMinutes;
}
