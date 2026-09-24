package org.campus.classroom.service;

import org.campus.classroom.vo.SystemConfigVO;

import java.time.LocalTime;
import java.util.List;

public interface SystemConfigService {
    List<SystemConfigVO> listConfigs(String category);

    SystemConfigVO updateConfig(String key, String value);

    int getMaxSingleReservationMinutes(Integer creditScore);

    int getDailyReservationLimitMinutes(Integer creditScore);

    int getCheckInEarlyMinutes();

    int getCheckInGraceMinutes();

    int getCheckInRewardScore();

    int getNoShowDeductionScore();

    int getSeatReservationAdvanceHours(Integer creditScore);

    int getCancelDeductionScore();

    int getDailyRecoveryScore();

    int getSuccessStreakRewardScore();

    int getSuccessStreakSize();

    int getCreditMinScore();

    int getCreditMaxScore();

    String getCreditLevelCode(Integer creditScore);

    LocalTime getReservationStartTime();

    LocalTime getReservationEndTime();
}
