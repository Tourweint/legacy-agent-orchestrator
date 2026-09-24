package org.campus.classroom.vo;

import lombok.Data;

@Data
public class AdminTimeSlotHeatVO {
    private String label;
    private Long reservationCount;
    private Long reservedMinutes;
}
