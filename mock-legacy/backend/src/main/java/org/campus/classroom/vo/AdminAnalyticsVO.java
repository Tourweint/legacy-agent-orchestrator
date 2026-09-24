package org.campus.classroom.vo;

import lombok.Data;

import java.util.List;

@Data
public class AdminAnalyticsVO {
    private Integer windowDays;
    private String windowLabel;
    private Integer classroomCount;
    private Integer enabledClassroomCount;
    private Integer totalUserCount;
    private Long totalReservations;
    private Long activeReservations;
    private Long checkedInCount;
    private Long noShowCount;
    private Long attendableReservationCount;
    private Long totalReservedMinutes;
    private Double overallUtilizationRate;
    private List<AdminClassroomUtilizationVO> classroomUtilizationList;
    private List<AdminBuildingHeatVO> hotBuildingList;
    private List<AdminTimeSlotHeatVO> hotTimeSlotList;
    private List<AdminUserReservationStatVO> userReservationList;
}
