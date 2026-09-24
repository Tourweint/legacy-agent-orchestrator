package org.campus.classroom.vo;

import lombok.Data;

@Data
public class AdminUserReservationStatVO {
    private Long userId;
    private String username;
    private String nickname;
    private String role;
    private Long reservationCount;
    private Long activeReservationCount;
    private Long checkedInCount;
    private Long noShowCount;
    private Double noShowRate;
    private Long reservedMinutes;
}
