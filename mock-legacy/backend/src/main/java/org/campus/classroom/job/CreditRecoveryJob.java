package org.campus.classroom.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.campus.classroom.service.AttendanceService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class CreditRecoveryJob {

    private final AttendanceService attendanceService;

    @Scheduled(cron = "0 5 0 * * *")
    public void recoverCreditScoreDaily() {
        int count = attendanceService.recoverCreditScoreDaily();
        if (count > 0) {
            log.info("[信用分每日恢复] 本次恢复用户数量: {}", count);
        }
    }
}
