package org.campus.classroom.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.campus.classroom.service.ReservationService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class ReservationExpireJob {

    private final ReservationService reservationService;

    /**
     * 每分钟执行一次
     */
    @Scheduled(fixedDelay = 60000)
    public void expireReservations() {
        int count = reservationService.expireActiveReservations();
        if (count >= 0) {
            log.info("[预约过期] 本次自动过期预约数量: {}", count);
        }
    }
}
