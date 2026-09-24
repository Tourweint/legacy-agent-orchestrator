package org.campus.classroom.vo;

import lombok.Data;

@Data
public class UserInfoVO {
    private Long id;
    private String username;
    private String nickname;
    private String email;
    private String role;
    private Integer creditScore;
    private String creditLevel;
    private Integer seatReservationAdvanceHours;
    private Integer maxSingleReservationMinutes;
    private Integer dailyReservationLimitMinutes;
}
