package org.campus.classroom.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.campus.classroom.service.AttendanceService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class ReservationNoShowJob {

    private final AttendanceService attendanceService;

    @Scheduled(fixedDelay = 60000)
    public void markNoShows() {
        int count = attendanceService.markNoShows();
        if (count > 0) {
            log.info("[预约爽约处理] 本次自动标记爽约数量: {}", count);
        }
    }
}
